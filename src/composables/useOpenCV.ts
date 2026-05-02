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

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.x/opencv.js'
const READY_TIMEOUT_MS = 30_000

/**
 * Inject the OpenCV.js CDN script tag once. We do this lazily (not from
 * index.html) because the WASM compile blocks the main thread hard enough
 * to crash unrelated pages with RESULT_CODE_HUNG. Pages that don't need
 * OpenCV never pay the cost.
 *
 * The injected tag is module-scoped and idempotent — calling this multiple
 * times only ever adds one <script> to the DOM.
 */
function injectOpenCvScript() {
  if (document.querySelector(`script[src="${OPENCV_CDN_URL}"]`)) return
  const s = document.createElement('script')
  s.src = OPENCV_CDN_URL
  s.async = true
  // No crossorigin attr — opencv.org doesn't send the right CORS header,
  // and we don't read the script body (just rely on the side effect of
  // setting window.cv).
  document.head.appendChild(s)
}

/**
 * Resolves once OpenCV.js has finished initializing. Module-scoped so all
 * callers share one wait. Subsequent calls after first ready are immediate.
 *
 * Two phases:
 *   1. Inject the CDN <script> tag (no-op if already injected).
 *   2. Poll for window.cv to appear, then either resolve immediately
 *      (cv.Mat already defined) or attach onRuntimeInitialized.
 *
 * Times out after 30s — at that point the CDN is genuinely unreachable
 * (network, ad-blocker, captive portal) and the editor surfaces the error.
 */
export function whenOpenCvReady(): Promise<OpenCv> {
  if (readyPromise) return readyPromise

  // Defer the actual WASM-loading work to the next macrotask so the editor
  // body has a chance to paint first. Without this, opening /editor for the
  // first time freezes the renderer long enough that Chrome decides it's
  // hung. The setTimeout is enough to let Vue's mount + first frame complete.
  readyPromise = new Promise<OpenCv>((resolve, reject) => {
    setTimeout(() => {
      injectOpenCvScript()

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

      // Fast path: cv is already on window (HMR, re-mount, etc.).
      if (typeof window.cv !== 'undefined') {
        attach(window.cv)
        return
      }

      // Poll for window.cv every 100ms; bail at READY_TIMEOUT_MS.
      const interval = setInterval(() => {
        if (typeof window.cv !== 'undefined') {
          clearInterval(interval)
          attach(window.cv)
          return
        }
        if (Date.now() - startedAt > READY_TIMEOUT_MS) {
          clearInterval(interval)
          const msg = 'OpenCV.js no se cargó. Revisá tu conexión.'
          error.value = msg
          reject(new Error(msg))
        }
      }, 100)
    }, 0)
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
