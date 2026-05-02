/**
 * Worker-backed auto-crop composable.
 *
 * Replaces the main-thread useAutoCrop. Same input shape (HTMLImageElement +
 * options) and same output shape (DieCutResult), but the OpenCV runtime +
 * pipeline run in a Web Worker so the main thread stays responsive while the
 * ~10 MB WASM bundle compiles. Without this, Chrome's hang detector trips
 * "Page Unresponsive" on first /editor open.
 *
 * Architecture:
 *   - One module-scoped Worker for the whole app (singleton). Vite bundles
 *     the worker file separately via `new Worker(new URL('...'))`.
 *   - The worker emits `{ kind: 'ready' }` once OpenCV finishes initializing.
 *     `isReady` flips true; the editor can show "Auto cut" as enabled.
 *   - Requests get a monotonically increasing requestId; the composable
 *     stores a pending-promise map and resolves the right one when a
 *     `{ kind: 'result' | 'error', requestId }` message comes back.
 *
 * Why classic worker (not module): we use `importScripts(opencv.js)` inside
 * the worker. Classic workers support importScripts; module workers don't.
 * Vite's `new Worker(new URL(...))` handles both — pass `{ type: 'classic' }`
 * to opt into classic. (See vite.dev/guide/features.html#web-workers.)
 */

import { ref } from 'vue'

export interface AutoCropOptions {
  cannyLow?: number
  cannyHigh?: number
  blurRadius?: number
  polyEpsilon?: number
}

export interface ImagePoint {
  kind: 'image'
  x: number
  y: number
}

export type DieCutResult =
  | { kind: 'ok'; points: ImagePoint[]; areaPx: number }
  | { kind: 'no-contour-found' }

type WorkerMessage =
  | { kind: 'ready'; requestId: number }
  | { kind: 'progress'; requestId: number; message: string }
  | { kind: 'result'; requestId: number; result: DieCutResult }
  | { kind: 'error'; requestId: number; message: string }

const MAX_WORKING_SIZE = 1024

// === Module-scoped singleton ===

let worker: Worker | null = null
let nextRequestId = 1
const pending = new Map<
  number,
  {
    resolve: (r: DieCutResult) => void
    reject: (e: Error) => void
    onProgress?: (message: string) => void
  }
>()

const isReady = ref(false)
const error = ref<string | null>(null)

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/autoCrop.worker.ts', import.meta.url), {
    type: 'classic',
    name: 'auto-crop-worker',
  })

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data
    if (msg.kind === 'ready') {
      isReady.value = true
      return
    }
    const handler = pending.get(msg.requestId)
    if (!handler) return
    if (msg.kind === 'progress') {
      handler.onProgress?.(msg.message)
      return
    }
    pending.delete(msg.requestId)
    if (msg.kind === 'result') {
      handler.resolve(msg.result)
    } else {
      handler.reject(new Error(msg.message))
    }
  }

  worker.onerror = (event) => {
    // Worker crash. Fail every pending request so the UI doesn't hang.
    const message = event.message || 'Worker error'
    error.value = message
    for (const [id, handler] of pending) {
      handler.reject(new Error(message))
      pending.delete(id)
    }
    // Don't kill the worker — Vite/HMR can recover.
  }

  return worker
}

// === Helpers ===

/**
 * Render the source image into an OffscreenCanvas at working resolution
 * (≤ 1024 px long edge) and read out as ImageData. ImageData is structured-
 * cloneable, so it crosses the worker boundary cleanly.
 */
function imageToWorkingImageData(image: HTMLImageElement): {
  imageData: ImageData
  workingWidth: number
  workingHeight: number
} {
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight)
  const scale = longEdge > MAX_WORKING_SIZE ? MAX_WORKING_SIZE / longEdge : 1
  const workingWidth = Math.max(1, Math.round(image.naturalWidth * scale))
  const workingHeight = Math.max(1, Math.round(image.naturalHeight * scale))

  // OffscreenCanvas is universal in evergreen browsers. Fallback to a
  // detached <canvas> if it ever isn't.
  let imageData: ImageData
  if (typeof OffscreenCanvas !== 'undefined') {
    const off = new OffscreenCanvas(workingWidth, workingHeight)
    const ctx = off.getContext('2d')
    if (!ctx) throw new Error('No 2D context on OffscreenCanvas')
    ctx.drawImage(image, 0, 0, workingWidth, workingHeight)
    imageData = ctx.getImageData(0, 0, workingWidth, workingHeight)
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = workingWidth
    canvas.height = workingHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No 2D context on fallback canvas')
    ctx.drawImage(image, 0, 0, workingWidth, workingHeight)
    imageData = ctx.getImageData(0, 0, workingWidth, workingHeight)
  }

  return { imageData, workingWidth, workingHeight }
}

// === Public composable ===

export function useAutoCropWorker() {
  const isProcessing = ref(false)
  const lastResult = ref<DieCutResult | null>(null)
  const lastError = ref<string | null>(null)
  const progressMessage = ref<string | null>(null)

  // Spin up the worker on first use so OpenCV starts loading in the
  // background. Calling getWorker() multiple times is safe (memoized).
  getWorker()

  async function run(
    image: HTMLImageElement,
    options: AutoCropOptions = {},
  ): Promise<DieCutResult> {
    isProcessing.value = true
    lastError.value = null
    progressMessage.value = null

    try {
      const { imageData, workingWidth, workingHeight } = imageToWorkingImageData(image)
      const requestId = nextRequestId++
      const w = getWorker()

      const result = await new Promise<DieCutResult>((resolve, reject) => {
        pending.set(requestId, {
          resolve,
          reject,
          onProgress: (msg) => {
            progressMessage.value = msg
          },
        })
        // Snapshot `options` to a plain object — callers commonly pass a
        // Vue reactive ref's .value, which is a Proxy. Proxies aren't
        // structured-cloneable; postMessage would throw DataCloneError.
        // Spreading into a fresh object strips the reactivity wrapper.
        w.postMessage({
          kind: 'auto-crop',
          requestId,
          imageData,
          workingWidth,
          workingHeight,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          options: { ...options },
        })
      })

      lastResult.value = result
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      lastError.value = msg
      throw e
    } finally {
      isProcessing.value = false
      progressMessage.value = null
    }
  }

  return {
    isReady,
    isProcessing,
    lastResult,
    error: lastError,
    workerError: error,
    progressMessage,
    run,
  }
}
