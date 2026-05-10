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
import { DEFAULT_PALETTE, type MaskPalette, onTextureReady } from '@/utils/materialColors'
import { smoothPolygonPerimeter } from '@/utils/polygon'

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

/**
 * Trace a closed contour as a smooth curve through `points` on `ctx`.
 *
 * For each consecutive pair (p[i], p[i+1]) we draw a quadratic Bézier whose
 * control point is p[i] and whose end point is the midpoint of (p[i], p[i+1]).
 * This is one pass of Chaikin's corner-cutting algorithm done at render
 * time — turning a polygonal contour (sharp lineTo segments visible at
 * every vertex) into a continuous curve where every former vertex becomes
 * a smooth tangent transition.
 *
 * Hugs the silhouette closely (no inflation), no kinks visible.
 *
 * Caller is responsible for `beginPath()`. The function does not call
 * `closePath()` — `fill()` and `clip()` close implicitly.
 */
function traceSmoothClosedCurve(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
) {
  const n = points.length
  if (n < 3) {
    if (n > 0) ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < n; i++) ctx.lineTo(points[i].x, points[i].y)
    return
  }
  const startMidX = (points[n - 1].x + points[0].x) / 2
  const startMidY = (points[n - 1].y + points[0].y) / 2
  ctx.moveTo(startMidX, startMidY)
  for (let i = 0; i < n; i++) {
    const cp = points[i]
    const next = points[(i + 1) % n]
    const midX = (cp.x + next.x) / 2
    const midY = (cp.y + next.y) / 2
    ctx.quadraticCurveTo(cp.x, cp.y, midX, midY)
  }
}

/** Map UI slider value (0–10) to smoothing-pass count (0–25).
 *  Slider 0 = raw silhouette (no extra smoothing on top of the always-on
 *  quadratic-curve render). Slider 10 = 25 passes of perimeter-blur,
 *  which collapses every concavity into a smooth wavy silhouette
 *  matching the "label shape" the customer pointed at as max.
 *
 *  Exported so the WebGL FX layer can apply the EXACT same smoothing
 *  to its stencil polygons — without that, the FX boundary visibly
 *  diverges from the base canvas's clipped artwork edge. */
export function iterationCountFromSliderValue(slider: number): number {
  return Math.round((Math.max(0, Math.min(10, slider)) / 10) * 25)
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
  /** Tight artwork silhouette (no bleed). When present and removeBackground
   *  is on, the base layer is clipped to this instead of `maskPoints` so
   *  the halo shows in the bleed margin without the photo's background
   *  occluding it. Set by setMask(points, artworkPoints?). */
  const artworkPoints = shallowRef<ImagePoint[] | null>(null)
  /** Whether the mask layer is visible. Toggled by EditorInspector. */
  const maskVisible = ref(true)
  /** Halo + stroke colors. Defaults to brand orange; the editor swaps in a
   *  material-tinted palette when the customer picks one in the inspector. */
  const maskPalette = ref<MaskPalette>(DEFAULT_PALETTE)
  /** When true AND we have a mask polygon, the base layer is clipped to the
   *  polygon — pixels outside become transparent so the canvas's checker
   *  background shows through (== "white background removed" effect). */
  const removeBackground = ref(false)
  /** When true, draw the base image at reduced opacity so the canvas's
   *  checker pattern shows through the artwork too — used for the
   *  "vinilo transparente" material. */
  const transparentMaterial = ref(false)
  /** When true, the customer has chosen a material with a colored halo.
   *  Drives the halo-rendering branch in drawMaskLayer; no longer
   *  affects base-image opacity (see drawBaseLayer). */
  const materialActive = ref(false)
  /** True when the chosen material is holographic (`holografico` or
   *  `holografico_transparente`). Drives the iridescent overlay drawn
   *  on top of the artwork in drawBaseLayer. */
  const isHolographicMaterial = ref(false)
  /** Effect mode the WebGL FX layer should render. Set by EditorView
   *  whenever the customer picks a material. Single source of truth for
   *  per-material visual treatment beyond the bleed halo color, which
   *  is owned separately by the mask layer. */
  const effectMode = ref<
    | 'holographic'
    | 'holographic_transparent'
    | 'luminescent'
    | 'eggshell_holographic'
    | null
  >(null)
  /** UI smoothing slider value (2–10). Drives perimeter-Gaussian passes
   *  applied to the polygon before rendering. The minimum is 2 — below
   *  that, per-vertex normal-offset self-intersections (from sharp
   *  silhouette concavities like fur tufts) produce visible spikes/loops
   *  around the cut line. 2 = barely smoothed; 10 = very wavy. Default
   *  3 = subtle smoothing. Doesn't re-run OpenCV; pure JS geometry on
   *  the saved polygon. */
  const smoothingSlider = ref<number>(3)

  // === Internals (not reactive) ===
  let resizeObserver: ResizeObserver | null = null
  let pendingFrame = 0
  let fit: FitTransform | null = null
  /** Reactive mirror of `fit` — exposed so consumers (the holographic FX
   *  layer, etc.) can react to layout changes. We can't make `fit` itself
   *  a ref because it's read 100x per draw; updating a ref every recompute
   *  would trigger watchers we don't want. Instead, recomputeFit writes
   *  to both. */
  const fitRef = shallowRef<FitTransform | null>(null)

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
    fitRef.value = fit
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

  // (Holographic shimmer used to live here as a 2D screen-blend gradient.
  // It's now rendered by the WebGL FX layer — see useHolographicFX.ts —
  // which produces a richer animated effect with proper iridescence and
  // mouse-responsive highlights. The base layer's only job is the
  // artwork pixels.)

  function drawBaseLayer() {
    const canvas = baseCanvas.value
    if (!canvas || !image.value) return
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    if (!fit) return

    // Whenever a cut polygon exists, the base image is ALWAYS clipped to
    // it. That's what `corte contorneado` means: the customer prints +
    // cuts only what's inside the polygon, so the preview should never
    // show the source image's background bleeding past the cut line.
    //
    // The "Quitar fondo" toggle picks WHICH polygon clips the base:
    //   - ON  → tight artwork polygon (`artworkPoints`). Lets the halo
    //           show in the bleed margin between the artwork edge and
    //           the cut line, matching the reference shop.
    //   - OFF → the full cut polygon (`maskPoints`), which includes the
    //           bleed margin. The base image fills the cut area edge-to-
    //           edge — no halo bleed-through. Customer sees the printed
    //           sticker as it would arrive at their door.
    // Geometric shapes (cuadrado/circulo/redondeadas) have no
    // `artworkPoints`; they always clip to the cut polygon regardless.
    const clipPoints = removeBackground.value
      ? (artworkPoints.value ?? maskPoints.value)
      : maskPoints.value
    const shouldClip = !!clipPoints && clipPoints.length > 0
    if (shouldClip) {
      ctx.save()
      // Smooth the clip path with the same iteration count as the mask
      // layer, so the clipped artwork edge matches the rendered cut path
      // exactly (no daylight between them at "sharp" vertices). The
      // tight `artworkPoints` get smoothed too — preserves the symmetry
      // between the inner clip and the outer cut polygon.
      const clipIterations = iterationCountFromSliderValue(smoothingSlider.value)
      const smoothedClip = smoothPolygonPerimeter(clipPoints!, clipIterations)
      const cssClip: { x: number; y: number }[] = []
      for (const p of smoothedClip) {
        const css = imageToCss({ kind: 'image', x: p.x, y: p.y })
        if (css) cssClip.push(css)
      }
      ctx.beginPath()
      traceSmoothClosedCurve(ctx, cssClip)
      ctx.clip()
    }
    // Base-image opacity. ONLY "vinilo transparente" gets a hard alpha
    // drop, so the canvas's checker pattern shows through and the
    // customer reads it as "transparent vinyl, surface behind shows
    // through". For all other materials the artwork renders at full
    // opacity — the holographic / metallic look comes from a separate
    // overlay layer drawn after the artwork (see drawHolographicOverlay
    // below), NOT from washing out the artwork's own colors. Previously
    // we dropped to 88% to let the halo bleed through, which muted the
    // base colors uniformly and didn't match the reference shop's
    // "iridescent reflections on top of vivid artwork" look.
    const priorAlpha = ctx.globalAlpha
    if (transparentMaterial.value) {
      ctx.globalAlpha = priorAlpha * 0.55
    }
    ctx.drawImage(image.value.source, fit.offsetX, fit.offsetY, fit.drawW, fit.drawH)
    ctx.globalAlpha = priorAlpha

    if (shouldClip) ctx.restore()
  }

  function drawMaskLayer() {
    const canvas = maskCanvas.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)

    if (!maskVisible.value || !maskPoints.value || !fit || maskPoints.value.length === 0) return

    // Two-stage smoothing:
    //   1. Perimeter-Gaussian on the silhouette (`smoothPolygonPerimeter`)
    //      — the "Suavizado" slider drives this. Each pass blurs each
    //      vertex with its neighbors; multiple passes ≈ Gaussian along
    //      the perimeter. 0 = raw silhouette; max = no detail, fully wavy.
    //   2. Always-on quadratic-curve render (`traceSmoothClosedCurve`)
    //      below, which gives every remaining vertex a smooth tangent.
    // Both passes are pure geometry; cheap to recompute every frame.
    const iterations = iterationCountFromSliderValue(smoothingSlider.value)
    const smoothedImagePoints = smoothPolygonPerimeter(maskPoints.value, iterations)
    const cssPoints: { x: number; y: number }[] = []
    for (const p of smoothedImagePoints) {
      const css = imageToCss({ kind: 'image', x: p.x, y: p.y })
      if (css) cssPoints.push(css)
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of cssPoints) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    ctx.beginPath()
    traceSmoothClosedCurve(ctx, cssPoints)

    // Resolve fill. palette.fill can be:
    //   - a flat CSS string (default brand orange, simple metallic)
    //   - a factory returning a gradient/pattern/string (legacy shape)
    //   - a factory returning a ResolvedFill (gradient/pattern + opacity)
    // The third form lets pattern-based materials (holographic) carry their
    // own globalAlpha so the texture doesn't fully obscure the artwork —
    // patterns can't bake alpha into their fillStyle directly.
    const palette = maskPalette.value
    const bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    const raw =
      typeof palette.fill === 'function'
        ? palette.fill(ctx, bbox)
        : palette.fill
    const resolved =
      typeof raw === 'object' && raw !== null && 'style' in raw && 'opacity' in raw
        ? (raw as { style: string | CanvasGradient | CanvasPattern; opacity: number })
        : { style: raw as string | CanvasGradient | CanvasPattern, opacity: 1 }

    const priorAlpha = ctx.globalAlpha
    ctx.globalAlpha = priorAlpha * resolved.opacity
    ctx.fillStyle = resolved.style
    ctx.fill()
    ctx.globalAlpha = priorAlpha
    ctx.strokeStyle = palette.stroke
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

  /** Set the polygon — typically the result of useAutoCrop().run().
   *  Optional `artwork` is the tight silhouette (no bleed) used as the
   *  clip mask when removeBackground is on; defaults to null (clip uses
   *  the cut polygon directly, appropriate for geometric shapes). */
  function setMask(points: ImagePoint[], artwork: ImagePoint[] | null = null): void {
    maskPoints.value = points
    artworkPoints.value = artwork
    drawMaskLayer()
    // The base layer is always clipped to the cut polygon when one
    // exists (see drawBaseLayer for why), so a new polygon ALWAYS
    // means we need to repaint the base — regardless of the
    // "Quitar fondo" toggle.
    drawBaseLayer()
  }

  function clearMask(): void {
    maskPoints.value = null
    artworkPoints.value = null
    drawMaskLayer()
    // Same reasoning: clearing the mask also means the base layer
    // stops being clipped, so it needs a full repaint.
    drawBaseLayer()
  }

  function setMaskVisible(visible: boolean): void {
    maskVisible.value = visible
    drawMaskLayer()
  }

  function setMaskPalette(palette: MaskPalette): void {
    maskPalette.value = palette
    drawMaskLayer()
  }

  function setRemoveBackground(enabled: boolean): void {
    removeBackground.value = enabled
    // The base layer is the only thing that changes; redraw it.
    drawBaseLayer()
  }

  function setTransparentMaterial(enabled: boolean): void {
    transparentMaterial.value = enabled
    drawBaseLayer()
  }

  function setMaterialActive(active: boolean): void {
    materialActive.value = active
    drawBaseLayer()
  }

  function setHolographicMaterial(holographic: boolean): void {
    isHolographicMaterial.value = holographic
    drawBaseLayer()
  }

  /** Set the WebGL FX mode for the current material. Single source of
   *  truth for per-material visual effects beyond the bleed halo. The
   *  caller (EditorView) maps the material identifier to one of the
   *  concrete modes. `null` = no FX. */
  function setEffectMode(
    mode:
      | 'holographic'
      | 'holographic_transparent'
      | 'luminescent'
      | 'eggshell_holographic'
      | null,
  ): void {
    effectMode.value = mode
  }

  /** Set the UI smoothing slider value (0–10). Re-renders the mask layer
   *  and (if removeBackground is on) the base layer's clip mask. Does NOT
   *  re-run OpenCV — the polygon stays the same; only the geometric
   *  smoothing applied at render time changes. */
  function setSmoothingSlider(value: number): void {
    // Floor at 2 — below this, polygon self-intersections become visible.
    // See the smoothingSlider ref doc for full rationale.
    smoothingSlider.value = Math.max(2, Math.min(10, value))
    drawMaskLayer()
    // The clip uses the smoothed polygon too, so any time the smoothing
    // changes we redraw the base layer regardless of the "Quitar fondo"
    // toggle (the clip exists either way under the new semantics).
    drawBaseLayer()
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
    // Same smoothing pipeline as the on-screen mask, so the uploaded
    // die-cut mask matches exactly what the customer saw. The shop's
    // cutter cuts the smoothed shape, not the raw silhouette.
    const exportIterations = iterationCountFromSliderValue(smoothingSlider.value)
    const smoothedExport = smoothPolygonPerimeter(maskPoints.value, exportIterations)
    ctx.beginPath()
    traceSmoothClosedCurve(
      ctx as unknown as CanvasRenderingContext2D,
      smoothedExport,
    )
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

  let unsubTextureReady: (() => void) | null = null

  onMounted(() => {
    resizeAll()
    if (stack.value) {
      resizeObserver = new ResizeObserver(() => resizeAll())
      resizeObserver.observe(stack.value)
    }
    // Repaint the mask once the holographic texture finishes loading. If
    // a customer picks "holográfico" before the image arrives the halo
    // would be stuck on the flat fallback otherwise.
    unsubTextureReady = onTextureReady(() => drawMaskLayer())
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (pendingFrame) cancelAnimationFrame(pendingFrame)
    if (pendingResizeFrame) cancelAnimationFrame(pendingResizeFrame)
    unsubTextureReady?.()
    unsubTextureReady = null
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
    artworkPoints,
    maskVisible,
    smoothingSlider,
    // Reactive layout transform (image-natural-px → CSS-px). Kept in sync
    // with the closure-local `fit` so consumers (holographic FX) can
    // watch for resize / load and rebuild dependent textures.
    fit: fitRef,
    isHolographicMaterial,
    effectMode,
    // event handlers (template)
    onPointerDown,
    onPointerMove,
    onPointerUp,
    // operations
    loadImage,
    setMask,
    clearMask,
    setMaskVisible,
    setMaskPalette,
    setRemoveBackground,
    setTransparentMaterial,
    setMaterialActive,
    setHolographicMaterial,
    setEffectMode,
    setSmoothingSlider,
    getMaskAsBlob,
    reset,
  }
}
