import { ref } from 'vue'

/**
 * OpenCV.js readiness gate.
 *
 * The CDN script in index.html (`https://docs.opencv.org/4.x/opencv.js`) loads
 * asynchronously. The global `cv` object exists immediately, but `cv.imread`
 * and friends are only available AFTER `cv.onRuntimeInitialized` fires.
 *
 * This composable wraps that callback in a module-scoped promise so every
 * caller awaits the same initialization once. Subsequent component mounts
 * (HMR, second editor open) resolve immediately because cv.Mat is already
 * defined.
 *
 * The actual auto-crop pipeline lives in `useAutoCrop.ts` per the
 * `opencv-js-integration` skill. This composable owns readiness only.
 */

declare global {
  interface Window {
    cv?: OpenCv
  }
}

export interface MatLike {
  delete(): void
  rows: number
  cols: number
  intAt(row: number, col: number): number
}

export interface MatVectorLike {
  delete(): void
  size(): number
  get(idx: number): MatLike
}

/**
 * Minimal subset of the OpenCV.js API we use. Add to this as the editor
 * grows beyond auto-crop.
 */
export interface OpenCv {
  Mat: { new (): MatLike }
  MatVector: { new (): MatVectorLike }
  Size: { new (w: number, h: number): { width: number; height: number } }
  imread(canvas: HTMLCanvasElement | OffscreenCanvas): MatLike
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

  // Constants
  COLOR_RGBA2GRAY: number
  BORDER_DEFAULT: number
  RETR_EXTERNAL: number
  CHAIN_APPROX_SIMPLE: number

  // Runtime callback hook — set by the consumer, called by the WASM module
  // when the runtime is ready.
  onRuntimeInitialized?: () => void
}

let readyPromise: Promise<OpenCv> | null = null

const isReady = ref(false)
const error = ref<string | null>(null)

/**
 * Resolves once OpenCV.js has finished initializing. Module-scoped so all
 * callers share one wait. Subsequent calls after first ready are immediate.
 *
 * The CDN script tag in index.html has `async`, so by the time this code
 * runs `window.cv` may be:
 *   1. fully initialized — `cv.Mat` is defined → resolve immediately
 *   2. partially loaded — `cv` exists but `cv.Mat` is not yet → wait for
 *      `onRuntimeInitialized`
 *   3. not yet loaded — `cv` is undefined → poll until it appears, then
 *      install the callback. Don't reject preemptively, the script is in flight.
 *
 * After ~30s with `cv` still undefined we give up and reject — at that point
 * the CDN is genuinely unreachable (network, ad-blocker, etc.) and the editor
 * shows the "OpenCV.js no se cargó" banner.
 */
const READY_TIMEOUT_MS = 30_000

export function whenOpenCvReady(): Promise<OpenCv> {
  if (readyPromise) return readyPromise

  readyPromise = new Promise<OpenCv>((resolve, reject) => {
    const startedAt = Date.now()

    function attach(cv: OpenCv) {
      if (cv.Mat) {
        isReady.value = true
        resolve(cv)
        return
      }
      cv.onRuntimeInitialized = () => {
        isReady.value = true
        resolve(cv)
      }
    }

    // Fast path: cv is already on window.
    const cv = window.cv
    if (typeof cv !== 'undefined') {
      attach(cv)
      return
    }

    // Slow path: the async CDN script hasn't finished downloading yet. Poll
    // every 100ms until cv appears, then attach the callback. Bail at timeout.
    const interval = setInterval(() => {
      if (typeof window.cv !== 'undefined') {
        clearInterval(interval)
        attach(window.cv)
        return
      }
      if (Date.now() - startedAt > READY_TIMEOUT_MS) {
        clearInterval(interval)
        const msg = 'OpenCV.js no se cargó. Revisá la CDN en index.html.'
        error.value = msg
        reject(new Error(msg))
      }
    }, 100)
  })

  return readyPromise
}

/** Reactive readiness flag for templates ("waiting for OpenCV…" overlays). */
export function useOpenCV() {
  // Kick the promise so the flag flips even if a component never awaits it
  // explicitly. Safe to call multiple times.
  whenOpenCvReady().catch(() => {
    // The error ref is already populated by whenOpenCvReady; nothing to do.
  })
  return { isReady, error, whenOpenCvReady }
}
