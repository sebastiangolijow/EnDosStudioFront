/**
 * Auto-crop Web Worker.
 *
 * The OpenCV.js WASM bundle is ~10 MB. Compiling it on the main thread blocks
 * the page hard enough that Chrome's hang detector fires "Page Unresponsive".
 * Moving the runtime + pipeline into a worker keeps the main thread free —
 * the page paints normally, the editor's UI stays interactive, and only the
 * worker thread is busy while WASM compiles.
 *
 * Wire format:
 *   In:  { kind: 'auto-crop', requestId, imageData, naturalWidth, naturalHeight, options }
 *   Out: { kind: 'ready', requestId } | { kind: 'progress', requestId, message }
 *      | { kind: 'result', requestId, result } | { kind: 'error', requestId, message }
 *
 * `imageData` is the source image rendered into a working-size offscreen
 * canvas (≤ 1024 px long edge) and read out as ImageData. ImageData crosses
 * the worker boundary by structured-clone — the underlying ArrayBuffer is
 * copied, not transferred, because we still need it on the main thread for
 * the canvas display. (Transferring would zero out the source array.)
 *
 * Memory rule (per opencv-js-integration skill): every cv.Mat / cv.MatVector
 * MUST be `.delete()`-ed in `finally`. The worker context is long-lived;
 * leaks accumulate across runs the same way they do on the main thread.
 */

/// <reference lib="webworker" />

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.x/opencv.js'

declare const cv: OpenCv

interface MatLike {
  delete(): void
  rows: number
  cols: number
  intAt(row: number, col: number): number
}
interface MatVectorLike {
  delete(): void
  size(): number
  get(idx: number): MatLike
}
interface OpenCv {
  Mat: { new (rows?: number, cols?: number, type?: number): MatLike }
  MatVector: { new (): MatVectorLike }
  Size: { new (w: number, h: number): { width: number; height: number } }
  matFromImageData(imageData: ImageData): MatLike
  cvtColor(src: MatLike, dst: MatLike, code: number): void
  GaussianBlur(
    src: MatLike,
    dst: MatLike,
    ksize: { width: number; height: number },
    sigmaX: number,
    sigmaY: number,
    borderType: number,
  ): void
  Canny(src: MatLike, dst: MatLike, threshold1: number, threshold2: number): void
  findContours(
    image: MatLike,
    contours: MatVectorLike,
    hierarchy: MatLike,
    mode: number,
    method: number,
  ): void
  contourArea(contour: MatLike): number
  approxPolyDP(curve: MatLike, approx: MatLike, epsilon: number, closed: boolean): void

  COLOR_RGBA2GRAY: number
  BORDER_DEFAULT: number
  RETR_EXTERNAL: number
  CHAIN_APPROX_SIMPLE: number

  onRuntimeInitialized?: () => void
}

interface AutoCropOptions {
  cannyLow?: number
  cannyHigh?: number
  blurRadius?: number
  polyEpsilon?: number
}

interface ImagePoint {
  kind: 'image'
  x: number
  y: number
}

type DieCutResult =
  | { kind: 'ok'; points: ImagePoint[]; areaPx: number }
  | { kind: 'no-contour-found' }

type IncomingMessage =
  | {
      kind: 'auto-crop'
      requestId: number
      imageData: ImageData
      // The working-size canvas the imageData came from. Polygon points are
      // in working-pixel space; the main thread scales them back to
      // image-natural coordinates using the natural dims it owns.
      workingWidth: number
      workingHeight: number
      naturalWidth: number
      naturalHeight: number
      options: AutoCropOptions
    }

type OutgoingMessage =
  | { kind: 'ready'; requestId: number }
  | { kind: 'progress'; requestId: number; message: string }
  | { kind: 'result'; requestId: number; result: DieCutResult }
  | { kind: 'error'; requestId: number; message: string }

// Module-scoped readiness gate. The worker loads opencv.js exactly once;
// every incoming auto-crop request awaits this same promise.
let readyPromise: Promise<void> | null = null

function whenCvReady(): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = new Promise<void>((resolve, reject) => {
    try {
      // importScripts is only available in classic workers — this file is
      // bundled by Vite as { type: 'classic' } in useAutoCropWorker.ts.
       
      ;(self as unknown as { importScripts: (url: string) => void }).importScripts(OPENCV_CDN_URL)
    } catch (e) {
      reject(new Error(`importScripts failed: ${(e as Error).message}`))
      return
    }
    if (typeof cv === 'undefined') {
      reject(new Error('OpenCV.js loaded but cv global is undefined'))
      return
    }
    if ((cv as OpenCv).Mat) {
      resolve()
      return
    }
    ;(cv as OpenCv).onRuntimeInitialized = () => resolve()
  })
  return readyPromise
}

function post(msg: OutgoingMessage) {
  ;(self as unknown as Worker).postMessage(msg)
}

async function handleAutoCrop(req: Extract<IncomingMessage, { kind: 'auto-crop' }>) {
  const { requestId, imageData, workingWidth, workingHeight, naturalWidth, naturalHeight, options } = req

  try {
    post({ kind: 'progress', requestId, message: 'Cargando OpenCV…' })
    await whenCvReady()
    post({ kind: 'progress', requestId, message: 'Detectando contorno…' })

    const cannyLow = options.cannyLow ?? 50
    const cannyHigh = options.cannyHigh ?? 150
    const blurRadius = options.blurRadius ?? 5
    const polyEpsilon = options.polyEpsilon ?? 2
    const kernel = blurRadius % 2 === 0 ? blurRadius + 1 : blurRadius

    const src = cv.matFromImageData(imageData)
    const gray = new cv.Mat()
    const blurred = new cv.Mat()
    const edges = new cv.Mat()
    const contours = new cv.MatVector()
    const hierarchy = new cv.Mat()
    const approx = new cv.Mat()

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
      cv.GaussianBlur(gray, blurred, new cv.Size(kernel, kernel), 0, 0, cv.BORDER_DEFAULT)
      cv.Canny(blurred, edges, cannyLow, cannyHigh)
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

      if (contours.size() === 0) {
        post({ kind: 'result', requestId, result: { kind: 'no-contour-found' } })
        return
      }

      let bestIdx = 0
      let bestArea = -1
      for (let i = 0; i < contours.size(); i++) {
        const area = cv.contourArea(contours.get(i))
        if (area > bestArea) {
          bestArea = area
          bestIdx = i
        }
      }

      cv.approxPolyDP(contours.get(bestIdx), approx, polyEpsilon, true)

      // Map working-pixel polygon points back to image-natural coordinates.
      // The main thread cares about natural pixels (what the printer cuts).
      const scaleX = naturalWidth / workingWidth
      const scaleY = naturalHeight / workingHeight
      const points: ImagePoint[] = []
      for (let i = 0; i < approx.rows; i++) {
        points.push({
          kind: 'image',
          x: approx.intAt(i, 0) * scaleX,
          y: approx.intAt(i, 1) * scaleY,
        })
      }

      post({
        kind: 'result',
        requestId,
        result: {
          kind: 'ok',
          points,
          areaPx: bestArea * scaleX * scaleY,
        },
      })
    } finally {
      src.delete()
      gray.delete()
      blurred.delete()
      edges.delete()
      contours.delete()
      hierarchy.delete()
      approx.delete()
    }
  } catch (e) {
    post({
      kind: 'error',
      requestId,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data
  if (msg.kind === 'auto-crop') {
    void handleAutoCrop(msg)
  }
}

// Kick off the OpenCV load eagerly so by the time the customer hits
// Auto cut the runtime is already warm.
void whenCvReady().then(() => {
  post({ kind: 'ready', requestId: -1 })
})
