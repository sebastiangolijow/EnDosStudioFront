<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import {
  useCanvasEditor,
  iterationCountFromSliderValue,
} from '@/composables/useCanvasEditor'
import { useHolographicFX } from '@/composables/useHolographicFX'
import type { ImagePoint } from '@/composables/useAutoCrop'
import type { MaskPalette } from '@/utils/materialColors'

/**
 * Destructure the refs returned by the composable so Vue's `ref="name"`
 * template syntax can auto-bind to them. Using `const editor = use…()` and
 * `editor.baseCanvas` would require ref-callbacks; this is cleaner.
 */
const {
  stack,
  baseCanvas,
  maskCanvas,
  uiCanvas,
  image,
  maskPoints,
  artworkPoints,
  fit,
  effectMode,
  smoothingSlider,
  baseDirty,
  onPointerDown,
  onPointerMove,
  onPointerUp,
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
} = useCanvasEditor()

// === Holographic FX layer (WebGL) ===
//
// A fourth canvas, between the base layer and the UI layer. Its sole job
// is to paint the iridescent "holographic" reflection on top of the
// artwork (and at full strength in the bleed ring). Active only when the
// chosen material is holographic; transparent and idle otherwise.
//
// The FX layer reads the cut + artwork polygons from the editor
// composable's reactive state, plus the fit transform — anything that
// changes those triggers a stencil rebuild. The shader itself runs at
// ~60 fps for the live shimmer animation.
const fx = useHolographicFX()

onMounted(() => {
  fx.start()
})

// Drive FX size from the editor's fit (canvas was already sized by
// useCanvasEditor's ResizeObserver — we just mirror the CSS dims).
watch(fit, (f) => {
  if (!f) return
  // Read the current stack dimensions in CSS px. The FX canvas is
  // absolute-positioned over the same box, so it gets the same size.
  const el = stack.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  fx.setSize(rect.width, rect.height)
})

watch(effectMode, (mode) => {
  fx.setMode(mode)
})

// Push the polygon-pair to the FX layer whenever it changes. The shader
// pre-rasterizes the polygons to single-channel stencil textures (~ms
// even at 1024×1024) so per-frame point-in-polygon evaluation isn't
// needed — the cost is paid once per polygon update.
//
// `smoothingSlider` is a dependency too: when the customer drags Suavidad,
// the base canvas re-clips with a different smoothing pass count and the
// FX stencil must follow, otherwise the FX boundary visibly drifts away
// from the artwork's clipped edge.
watch(
  [maskPoints, artworkPoints, fit, image, smoothingSlider],
  ([cut, artwork, f, img, slider]) => {
    if (!cut || cut.length < 3 || !f || !img) {
      fx.setPolygons(null)
      return
    }
    fx.setPolygons({
      cut,
      artwork,
      imageWidth: img.naturalWidth,
      imageHeight: img.naturalHeight,
      fit: {
        offsetX: f.offsetX,
        offsetY: f.offsetY,
        drawW: f.drawW,
        drawH: f.drawH,
      },
      smoothingIterations: iterationCountFromSliderValue(slider as number),
    })
  },
)

// Re-upload the base canvas snapshot to the FX layer whenever the base
// repaints. The shader's bleed branch samples this to TINT (not
// overlay) the iridescence — preserving the underlying color (e.g.
// teal smart-cut bleed reads as teal-with-shimmer instead of rainbow
// paint over teal).
//
// baseDirty bumps inside `drawBaseLayer`, so by the time this watcher
// fires the base canvas's pixels are already painted — no extra
// nextTick coordination needed. The watcher captures setMask /
// setRemoveBackground / setTransparentMaterial / resize / loadImage
// / setSmoothingSlider redraws in one place.
watch(baseDirty, () => {
  if (baseCanvas.value) fx.setBaseSnapshot(baseCanvas.value)
})

// Track cursor position over the canvas stack so the shader can shift
// the iridescent gradient phase as the customer hovers — that's the
// "tilt to see the shimmer" feel of real holographic vinyl.
function onStackMove(e: PointerEvent) {
  const el = stack.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  fx.setMouse((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
}

onBeforeUnmount(() => {
  // FX composable cleans up its own GL resources via its own onBeforeUnmount.
})

/**
 * Imperative methods exposed via ref. The parent (EditorView) calls these
 * after wiring up the composable's data — e.g. when an Auto-detect button
 * is clicked or the customer presses Continuar.
 */
defineExpose({
  loadImage: (src: string) => loadImage(src),
  setMask: (points: ImagePoint[], artwork: ImagePoint[] | null = null) =>
    setMask(points, artwork),
  clearMask: () => clearMask(),
  setMaskVisible: (v: boolean) => setMaskVisible(v),
  setMaskPalette: (palette: MaskPalette) => setMaskPalette(palette),
  setRemoveBackground: (enabled: boolean) => setRemoveBackground(enabled),
  setTransparentMaterial: (enabled: boolean) => setTransparentMaterial(enabled),
  setMaterialActive: (active: boolean) => setMaterialActive(active),
  setHolographicMaterial: (holographic: boolean) =>
    setHolographicMaterial(holographic),
  setEffectMode: (
    mode:
      | 'holographic'
      | 'holographic_transparent'
      | 'luminescent'
      | 'eggshell_holographic'
      | null,
  ) => setEffectMode(mode),
  setSmoothingSlider: (value: number) => setSmoothingSlider(value),
  getMaskAsBlob: () => getMaskAsBlob(),
  reset: () => reset(),
  hasImage: () => !!image.value,
  hasMask: () => !!maskPoints.value && maskPoints.value.length > 0,
})
</script>

<template>
  <!-- 4-layer canvas stack. Order in DOM = visual order (later = on top).
       Mask FIRST (lowest), so the halo lives in the bleed margin only —
       the base image draws on top of it, covering the halo wherever the
       artwork exists (matches the reference shop: holographic vivid in
       the bleed, barely visible over the artwork itself).
       FX (WebGL) sits ABOVE the base so the iridescent shimmer paints
       on top of the artwork with alpha blending. Off when not holographic.
       UI stays last so it receives all pointer events. -->
  <div
    ref="stack"
    class="canvas-stack relative aspect-square w-full overflow-hidden rounded-lg border border-border"
    @pointermove="onStackMove"
  >
    <canvas
      ref="maskCanvas"
      class="absolute inset-0 size-full"
    />
    <canvas
      ref="baseCanvas"
      class="absolute inset-0 size-full"
    />
    <canvas
      :ref="(el) => { fx.canvas.value = (el as HTMLCanvasElement | null) }"
      class="absolute inset-0 size-full"
      data-testid="editor-fx-canvas"
    />
    <canvas
      ref="uiCanvas"
      class="absolute inset-0 size-full"
      data-testid="editor-ui-canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />

    <!-- Empty state while loading -->
    <div
      v-if="!image"
      class="pointer-events-none absolute inset-0 flex items-center justify-center text-text-muted"
    >
      <p class="text-sm">
        Cargando imagen…
      </p>
    </div>
  </div>
</template>

<style scoped>
.canvas-stack {
  /* Transparent-checker background under the image so the customer sees
     transparency clearly (matches the mockup's editor canvas treatment). */
  background-color: #1b2027;
  background-image:
    linear-gradient(45deg, #2a3038 25%, transparent 25%),
    linear-gradient(-45deg, #2a3038 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a3038 75%),
    linear-gradient(-45deg, transparent 75%, #2a3038 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, 10px 0px;

  /* touch-action: none stops the browser hijacking gestures (pinch-zoom,
     pull-to-refresh) when the customer is trying to draw on the canvas. */
  touch-action: none;
}

.canvas-stack > canvas:not(:last-child) {
  /* Lower layers don't intercept events; everything bubbles to the UI canvas. */
  pointer-events: none;
}
</style>
