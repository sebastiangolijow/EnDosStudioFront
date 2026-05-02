import { ref } from 'vue'

interface OpenCVReadyState {
  isReady: boolean
  error: string | null
}

const ready = ref<OpenCVReadyState>({ isReady: false, error: null })

let pendingPromise: Promise<void> | null = null

/**
 * Resolves once OpenCV.js has loaded and `window.cv` exposes `Mat` / `imread`.
 * Polls every 100ms with a 10s timeout.
 *
 * The CDN script tag in index.html has the `async` attribute, so this resolves
 * immediately if OpenCV loaded before the editor opens, or waits if it didn't.
 *
 * Cache the in-flight promise so concurrent callers share one wait.
 *
 * NOTE: This composable owns the readiness check only. The actual OpenCV.js
 * operations (Mat memory management, the auto-crop pipeline, downscale logic)
 * belong to a separate `useAutoCrop.ts` composable per the
 * `opencv-js-integration` skill.
 */
export function useOpenCV() {
  function waitForOpenCV(): Promise<void> {
    if (ready.value.isReady) return Promise.resolve()
    if (pendingPromise) return pendingPromise

    pendingPromise = new Promise<void>((resolve, reject) => {
      const start = Date.now()

      const check = () => {
        const cv = (window as unknown as { cv?: { Mat?: unknown } }).cv
        if (cv && cv.Mat) {
          ready.value = { isReady: true, error: null }
          pendingPromise = null
          resolve()
          return
        }

        if (Date.now() - start > 10_000) {
          ready.value = { isReady: false, error: 'OpenCV no se pudo cargar' }
          pendingPromise = null
          reject(new Error(ready.value.error!))
          return
        }

        setTimeout(check, 100)
      }

      check()
    })

    return pendingPromise
  }

  return {
    isReady: ready,
    waitForOpenCV,
  }
}
