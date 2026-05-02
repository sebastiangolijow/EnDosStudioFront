<script setup lang="ts">
import { useCanvasEditor } from '@/composables/useCanvasEditor'
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
  onPointerDown,
  onPointerMove,
  onPointerUp,
  loadImage,
  setMask,
  clearMask,
  setMaskVisible,
  setMaskPalette,
  getMaskAsBlob,
  reset,
} = useCanvasEditor()

/**
 * Imperative methods exposed via ref. The parent (EditorView) calls these
 * after wiring up the composable's data — e.g. when an Auto-detect button
 * is clicked or the customer presses Continuar.
 */
defineExpose({
  loadImage: (src: string) => loadImage(src),
  setMask: (points: ImagePoint[]) => setMask(points),
  clearMask: () => clearMask(),
  setMaskVisible: (v: boolean) => setMaskVisible(v),
  setMaskPalette: (palette: MaskPalette) => setMaskPalette(palette),
  getMaskAsBlob: () => getMaskAsBlob(),
  reset: () => reset(),
  hasImage: () => !!image.value,
  hasMask: () => !!maskPoints.value && maskPoints.value.length > 0,
})
</script>

<template>
  <!-- 3-layer canvas stack. CSS rules keep them perfectly stacked and
       route pointer events to the top (UI) layer only. The transparent-checker
       background sells "no fondo" to the customer when the image has alpha. -->
  <div
    ref="stack"
    class="canvas-stack relative aspect-square w-full overflow-hidden rounded-lg border border-border"
  >
    <canvas
      ref="baseCanvas"
      class="absolute inset-0 size-full"
    />
    <canvas
      ref="maskCanvas"
      class="absolute inset-0 size-full"
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
