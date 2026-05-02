/**
 * Canvas editor composable — owns the 3-layer canvas stack and all DOM
 * interaction with it. The .vue component is just the template + event glue.
 *
 * Three layers (per the `canvas-editor-system` skill):
 *   - base:  the customer's uploaded image. Drawn ONCE on load + on resize.
 *   - mask:  the OpenCV-generated die-cut polygon. Redrawn on auto-crop.
 *   - ui:    cursor / handles / hover. Redrawn per pointermove (rAF-throttled).
 *
 * Coordinate-system discipline (per the skill):
 *   - CSS pixels: getBoundingClientRect, event.clientX/Y, ctx after scale(dpr).
 *   - Image-natural pixels: image.naturalWidth × naturalHeight, OpenCV results.
 *   We translate between them via fitImageToCanvas() — one source of truth.
 *
 * Memory + cleanup:
 *   - ResizeObserver is created in onMounted, disconnected in onBeforeUnmount.
 *   - rAF handles are cancelled on unmount.
 *   - The OpenCV pipeline lives in useAutoCrop; this composable only stores
 *     the JS-side polygon points it returns. No Mats live here.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { type ImagePoint } from './useAutoCrop'

export interface ImageState {
  source: HTMLImageElement
  naturalWidth: number
  naturalHeight: number
}

/** Computed once per resize/load: how the image fits into the canvas (CSS pixels). */
interface FitTransform {
  /** Scale applied to image-natural pixels to produce CSS pixels. */
  scale: number
  /** Top-left of the drawn image inside the canvas, in CSS pixels. */
  offsetX: number
  offsetY: number
  /** Drawn image size in CSS pixels. */
  drawW: number
  drawH: number
}

export function useCanvasEditor() {
  // === Refs (template) ===
  const stack = ref<HTMLDivElement | null>(null)
  const baseCanvas = ref<HTMLCanvasElement | null>(null)
  const maskCanvas = ref<HTMLCanvasElement | null>(null)
  const uiCanvas = ref<HTMLCanvasElement | null>(null)

  // === Reactive state ===
  const image = shallowRef<ImageState | null>(null)
  /** Polygon points in image-natural pixels — survives resize. */
  const maskPoints = shallowRef<ImagePoint[] | null>(null)
  /** Whether the mask layer is visible. Toggled by EditorInspector. */
  const maskVisible = ref(true)

  // === Internals (not reactive) ===
  let resizeObserver: ResizeObserver | null = null
  let pendingFrame = 0
  let fit: FitTransform | null = null

  // === Geometry ===

  /**
   * Compute how image-natural fits into the canvas (CSS pixels).
   * Contain-fit: preserves aspect ratio, centers within the canvas.
   * Source of truth — every draw + every coordinate transform reads this.
   */
  function recomputeFit(canvasCssWidth: number, canvasCssHeight: number) {
    if (!image.value) {
      fit = null
      return
    }
    const { naturalWidth, naturalHeight } = image.value
    const scale = Math.min(canvasCssWidth / naturalWidth, canvasCssHeight / naturalHeight)
    const drawW = naturalWidth * scale
    const drawH = naturalHeight * scale
    fit = {
      scale,
      drawW,
      drawH,
      offsetX: (canvasCssWidth - drawW) / 2,
      offsetY: (canvasCssHeight - drawH) / 2,
    }
  }

  function imageToCss(p: ImagePoint): { x: number; y: number } | null {
    if (!fit) return null
    return {
      x: fit.offsetX + p.x * fit.scale,
      y: fit.offsetY + p.y * fit.scale,
    }
  }

  // === Per-layer setup ===

  /**
   * Resize a single canvas to match its parent box at DPR resolution.
   * Sets the bitmap size in real pixels, then scales the context so all
   * drawing is in CSS pixels. Per `canvas-editor-system` skill.
   *
   * Returns true if the bitmap dimensions actually changed. Returning false
   * lets the caller skip a redraw — and breaks the ResizeObserver loop that
   * sub-pixel rounding can trigger (write `canvas.width = 1280` → DOM lays
   * out → RO fires → we read 1280.0001 → write 1280 again → RO fires…).
   */
  function resizeCanvas(canvas: HTMLCanvasElement): boolean {
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const targetW = Math.round(rect.width * dpr)
    const targetH = Math.round(rect.height * dpr)

    // Skip if nothing meaningful changed. Both dimensions must match — a
    // viewport rotation could change just one.
    if (canvas.width === targetW && canvas.height === targetH) return false

    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    return true
  }

  // === Per-layer drawing ===

  function drawBaseLayer() {
    const canvas = baseCanvas.value
    if (!canvas || !image.value) return
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    if (!fit) return
    ctx.drawImage(image.value.source, fit.offsetX, fit.offsetY, fit.drawW, fit.drawH)
  }

  function drawMaskLayer() {
    const canvas = maskCanvas.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)

    if (!maskVisible.value || !maskPoints.value || !fit || maskPoints.value.length === 0) return

    // Trace the polygon in CSS pixels.
    ctx.beginPath()
    for (let i = 0; i < maskPoints.value.length; i++) {
      const css = imageToCss(maskPoints.value[i])
      if (!css) continue
      if (i === 0) ctx.moveTo(css.x, css.y)
      else ctx.lineTo(css.x, css.y)
    }
    ctx.closePath()

    // Translucent fill + crisp orange stroke for the cut line.
    ctx.fillStyle = 'rgba(255, 61, 10, 0.15)'
    ctx.fill()
    ctx.strokeStyle = '#FF3D0A'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  function drawUiLayer() {
    const canvas = uiCanvas.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    // No interactive UI in M2 (drawn relief is post-MVP). Reserved for cursor
    // crosshair + drag handles when those land.
  }

  function scheduleUiRedraw() {
    if (pendingFrame) return
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0
      drawUiLayer()
    })
  }

  // === Pointer events ===

  function onPointerDown(e: PointerEvent) {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    scheduleUiRedraw()
  }
  function onPointerMove(_e: PointerEvent) {
    scheduleUiRedraw()
  }
  function onPointerUp(_e: PointerEvent) {
    scheduleUiRedraw()
  }

  // === Resize ===

  let pendingResizeFrame = 0

  /**
   * Apply pending resizes inside an rAF so multiple ResizeObserver fires
   * coalesce into one pass. Without this, a layout that ripples sizes
   * across two frames can wedge the observer in a tight loop and tank the
   * tab with RESULT_CODE_HUNG.
   *
   * Inside the rAF: only redraw if at least one canvas's bitmap actually
   * changed. Otherwise we'd be repainting megabytes for nothing — and the
   * sub-pixel rounding loop wouldn't terminate.
   */
  function resizeAll() {
    if (pendingResizeFrame) return
    pendingResizeFrame = requestAnimationFrame(() => {
      pendingResizeFrame = 0
      let changed = false
      if (baseCanvas.value && resizeCanvas(baseCanvas.value)) changed = true
      if (maskCanvas.value && resizeCanvas(maskCanvas.value)) changed = true
      if (uiCanvas.value && resizeCanvas(uiCanvas.value)) changed = true

      if (!changed) return

      // Recompute fit using the current CSS size of the base canvas.
      if (baseCanvas.value) {
        const rect = baseCanvas.value.getBoundingClientRect()
        recomputeFit(rect.width, rect.height)
      }

      // The bitmap was wiped — redraw all three layers.
      drawBaseLayer()
      drawMaskLayer()
      drawUiLayer()
    })
  }

  // === Public ops ===

  /** Load an image into the base layer from a URL (objectURL OR remote URL). */
  async function loadImage(src: string): Promise<void> {
    const img = new Image()
    // crossOrigin='anonymous' is needed for remote URLs so the canvas isn't
    // CORS-tainted when we cv.imread it later. But it MUST NOT be set on
    // blob:/data: URLs — they have no real origin and the browser treats
    // the CORS check as a failure, killing the load silently.
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      img.crossOrigin = 'anonymous'
    }
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
      img.src = src
    })
    image.value = {
      source: img,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    }
    // The image arrived: reset any prior mask, recompute fit, redraw base.
    maskPoints.value = null
    if (baseCanvas.value) {
      const rect = baseCanvas.value.getBoundingClientRect()
      recomputeFit(rect.width, rect.height)
    }
    drawBaseLayer()
    drawMaskLayer()
  }

  /** Set the polygon — typically the result of useAutoCrop().run(). */
  function setMask(points: ImagePoint[]): void {
    maskPoints.value = points
    drawMaskLayer()
  }

  function clearMask(): void {
    maskPoints.value = null
    drawMaskLayer()
  }

  function setMaskVisible(visible: boolean): void {
    maskVisible.value = visible
    drawMaskLayer()
  }

  /**
   * Render the mask polygon to a Blob at IMAGE-NATURAL resolution, suitable
   * for upload as the `die_cut_mask` OrderFile. The file is opaque-black
   * polygon on transparent background — that's the PNG mask convention.
   *
   * Returns null if no mask exists.
   */
  async function getMaskAsBlob(): Promise<Blob | null> {
    if (!maskPoints.value || !image.value || maskPoints.value.length === 0) return null

    const { naturalWidth, naturalHeight } = image.value
    const off = new OffscreenCanvas(naturalWidth, naturalHeight)
    const ctx = off.getContext('2d')
    if (!ctx) throw new Error('No 2D context on OffscreenCanvas')

    ctx.clearRect(0, 0, naturalWidth, naturalHeight)
    ctx.beginPath()
    for (let i = 0; i < maskPoints.value.length; i++) {
      const p = maskPoints.value[i]
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.fillStyle = '#000000'
    ctx.fill()

    return await off.convertToBlob({ type: 'image/png' })
  }

  function reset(): void {
    image.value = null
    maskPoints.value = null
    fit = null
    if (baseCanvas.value) {
      const ctx = baseCanvas.value.getContext('2d')!
      const rect = baseCanvas.value.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)
    }
    drawMaskLayer()
    drawUiLayer()
  }

  // === Lifecycle ===

  onMounted(() => {
    resizeAll()
    if (stack.value) {
      resizeObserver = new ResizeObserver(() => resizeAll())
      resizeObserver.observe(stack.value)
    }
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (pendingFrame) cancelAnimationFrame(pendingFrame)
    if (pendingResizeFrame) cancelAnimationFrame(pendingResizeFrame)
  })

  return {
    // refs (template)
    stack,
    baseCanvas,
    maskCanvas,
    uiCanvas,
    // reactive state (read-only outside)
    image,
    maskPoints,
    maskVisible,
    // event handlers (template)
    onPointerDown,
    onPointerMove,
    onPointerUp,
    // operations
    loadImage,
    setMask,
    clearMask,
    setMaskVisible,
    getMaskAsBlob,
    reset,
  }
}
