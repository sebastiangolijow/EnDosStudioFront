/**
 * Auto-crop composable — runs the OpenCV.js die-cut detection pipeline on
 * an HTMLImageElement and returns image-natural-pixel polygon points.
 *
 * Pipeline (per the `opencv-js-integration` skill):
 *   downscale (long edge ≤ 1024 px) → cvtColor RGBA→GRAY → GaussianBlur →
 *   Canny → findContours RETR_EXTERNAL → pick max-area contour →
 *   approxPolyDP → scale points back to image-natural coordinates.
 *
 * The pipeline blocks the main thread for 50–200 ms on a working-size image.
 * That's the threshold of perceptible jank but not catastrophic. We stay on
 * the main thread until a real perf complaint forces a Web Worker.
 *
 * Memory rule: every Mat / MatVector created here MUST be `.delete()`-ed
 * in `finally`. After ~10 leaked auto-crops, the WASM heap explodes.
 */
import { ref } from 'vue'
import { type MatLike, type MatVectorLike, whenOpenCvReady } from './useOpenCV'

/** Bound the working resolution. Bigger = more accurate, slower. 1024 px is fine. */
const MAX_WORKING_SIZE = 1024

/**
 * Customer-tunable knobs. Sliders in EditorInspector bind to these.
 * Defaults are sensible for a clean photo on a plain background.
 */
export interface AutoCropOptions {
  /** Canny low threshold. Lower = more edges (incl. noise). Default 50. */
  cannyLow?: number
  /** Canny high threshold. Higher = stricter edges. Default 150. */
  cannyHigh?: number
  /** GaussianBlur kernel size. Must be odd. Default 5. */
  blurRadius?: number
  /** approxPolyDP epsilon. Higher = simpler polygon (fewer points). Default 2. */
  polyEpsilon?: number
}

/**
 * Image-natural-pixel point. Tagged so we never mix it with CSS pixels.
 * Per the canvas-editor-system skill's coordinate-system discipline.
 */
export interface ImagePoint {
  kind: 'image'
  x: number
  y: number
}

export type DieCutResult =
  | {
      kind: 'ok'
      points: ImagePoint[]
      /** Area in image-natural pixels² — useful for "the sticker takes up most of the photo" sanity checks. */
      areaPx: number
    }
  | {
      kind: 'no-contour-found'
    }

function workingScale(image: HTMLImageElement): number {
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight)
  return longEdge > MAX_WORKING_SIZE ? MAX_WORKING_SIZE / longEdge : 1
}

/** Pure pipeline. Wraps Mat lifetime in try/finally — never leaks. */
export async function detectDieCut(
  image: HTMLImageElement,
  options: AutoCropOptions = {},
): Promise<DieCutResult> {
  const cv = await whenOpenCvReady()
  const {
    cannyLow = 50,
    cannyHigh = 150,
    blurRadius = 5,
    polyEpsilon = 2,
  } = options

  // GaussianBlur kernel size must be odd.
  const kernel = blurRadius % 2 === 0 ? blurRadius + 1 : blurRadius

  const scale = workingScale(image)
  const workingW = Math.round(image.naturalWidth * scale)
  const workingH = Math.round(image.naturalHeight * scale)

  // Use an offscreen canvas at the working size to feed cv.imread.
  // OffscreenCanvas is available in all evergreen browsers we target.
  const off = new OffscreenCanvas(workingW, workingH)
  const offCtx = off.getContext('2d')
  if (!offCtx) throw new Error('No 2D context on OffscreenCanvas')
  offCtx.drawImage(image, 0, 0, workingW, workingH)

  // Cast: imread accepts HTMLCanvasElement; OffscreenCanvas is structurally
  // compatible at runtime in modern OpenCV.js builds.
  const src: MatLike = cv.imread(off as unknown as HTMLCanvasElement)
  const gray: MatLike = new cv.Mat()
  const blurred: MatLike = new cv.Mat()
  const edges: MatLike = new cv.Mat()
  const contours: MatVectorLike = new cv.MatVector()
  const hierarchy: MatLike = new cv.Mat()
  const approx: MatLike = new cv.Mat()

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(kernel, kernel), 0, 0, cv.BORDER_DEFAULT)
    cv.Canny(blurred, edges, cannyLow, cannyHigh)
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    if (contours.size() === 0) {
      return { kind: 'no-contour-found' }
    }

    // Pick the largest contour by area — the sticker is presumably the biggest
    // thing in the photo against a contrasting background.
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

    // Convert working-pixel polygon points to image-natural coordinates.
    // Tag each as ImagePoint so downstream code can't mix with CSS pixels.
    const points: ImagePoint[] = []
    for (let i = 0; i < approx.rows; i++) {
      points.push({
        kind: 'image',
        x: approx.intAt(i, 0) / scale,
        y: approx.intAt(i, 1) / scale,
      })
    }

    return {
      kind: 'ok',
      points,
      areaPx: bestArea / (scale * scale),
    }
  } finally {
    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    contours.delete()
    hierarchy.delete()
    approx.delete()
  }
}

/**
 * Reactive wrapper for views: tracks isProcessing + lastResult so the UI can
 * show a spinner during the ~100 ms pipeline run.
 */
export function useAutoCrop() {
  const isProcessing = ref(false)
  const lastResult = ref<DieCutResult | null>(null)
  const error = ref<string | null>(null)

  async function run(
    image: HTMLImageElement,
    options?: AutoCropOptions,
  ): Promise<DieCutResult> {
    isProcessing.value = true
    error.value = null
    try {
      const result = await detectDieCut(image, options)
      lastResult.value = result
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      throw e
    } finally {
      isProcessing.value = false
    }
  }

  return { isProcessing, lastResult, error, run }
}
