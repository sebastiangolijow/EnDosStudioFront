<script setup lang="ts">
import { computed } from 'vue'
import type { Shape } from '@/types/order'

interface Props {
  /** Are we currently running the auto-crop pipeline? Disables the button. */
  isProcessing: boolean
  /** Has OpenCV.js finished loading? Disables tools that need it. */
  isOpenCvReady: boolean
  /** Cut shape — Auto cut only makes sense for contorneado. */
  shape: Shape
  /** Are we currently running smart-cut? Disables both cut buttons. */
  isSmartCutting?: boolean
  /** Does the order have an `original` file uploaded yet? Smart cut needs it. */
  hasOriginal?: boolean
  /** True when the current polygon was produced by smart-cut. Auto cut is
   *  locked out in this mode (clicking it would overwrite the AI result
   *  with the classical pipeline, which is rarely what the customer
   *  wants — the visual quality difference is too big to undo by accident). */
  isSmartCutActive?: boolean
  /** Current zoom level (1, 1.5, 2). Drives the Zoom button's sublabel. */
  zoomLevel?: number
  /** True when the undo stack has at least one snapshot. Enables Deshacer. */
  canUndo?: boolean
  /** True when the redo stack has at least one snapshot. Enables Rehacer. */
  canRedo?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isSmartCutting: false,
  hasOriginal: false,
  isSmartCutActive: false,
  zoomLevel: 1,
  canUndo: false,
  canRedo: false,
})

const emit = defineEmits<{
  'auto-cut': []
  'smart-cut': []
  'reset': []
  'zoom': []
  'undo': []
  'redo': []
}>()

// Auto cut is meaningful only for `contorneado` — for geometric shapes
// the mask is a fixed primitive, so the button is disabled (and visually
// muted) to avoid implying it does something. Disabled while smart-cut
// runs too: only one detection pipeline at a time.
const autoCutDisabled = computed(
  () =>
    props.isProcessing ||
    props.isSmartCutting ||
    props.isSmartCutActive ||
    !props.isOpenCvReady ||
    props.shape !== 'contorneado',
)

// Smart cut needs the original file uploaded (rembg input) and only
// makes sense for contorneado. Doesn't depend on OpenCV.js — the work
// runs on the server.
const smartCutDisabled = computed(
  () =>
    props.isProcessing ||
    props.isSmartCutting ||
    !props.hasOriginal ||
    props.shape !== 'contorneado',
)

/**
 * Tools shown in the toolbar. Auto cut + smart cut + Borrar + Zoom are
 * implemented; Deshacer / Rehacer are stubs (need a real history stack).
 *
 * `active` is DERIVED per-render from each tool's disabled state, not a
 * static flag. Earlier this was hardcoded `active: true` on the cut
 * buttons, which made Auto cut look orange-highlighted even when it was
 * disabled (e.g. while smart-cut was active). Now disabled tools always
 * read as muted; only currently-usable tools get the primary treatment.
 */
interface Tool {
  id: 'auto-cut' | 'smart-cut' | 'borrar' | 'zoom' | 'deshacer' | 'rehacer'
  icon: string
  label: string
  /** Optional sublabel under the main label (e.g. zoom level indicator). */
  sublabel?: string
  /** True when the button is currently clickable. Drives both `disabled`
   *  on the button and the "active" orange styling — disabled buttons
   *  never show as active. */
  enabled: boolean
}

const tools = computed<Tool[]>(() => [
  {
    id: 'auto-cut',
    icon: '✂️',
    label: 'Auto cut',
    enabled: !autoCutDisabled.value,
  },
  {
    id: 'smart-cut',
    icon: '✨',
    label: 'Recorte inteligente',
    enabled: !smartCutDisabled.value,
  },
  {
    id: 'borrar',
    icon: '🧽',
    label: 'Borrar',
    enabled: !props.isProcessing && !props.isSmartCutting,
  },
  {
    id: 'zoom',
    icon: '🔍',
    label: 'Zoom',
    sublabel: `${props.zoomLevel}x`,
    enabled: true,
  },
  {
    id: 'deshacer',
    icon: '↶',
    label: 'Deshacer',
    enabled: props.canUndo,
  },
  {
    id: 'rehacer',
    icon: '↷',
    label: 'Rehacer',
    enabled: props.canRedo,
  },
])

function onToolClick(toolId: Tool['id']) {
  if (toolId === 'auto-cut') return emit('auto-cut')
  if (toolId === 'smart-cut') return emit('smart-cut')
  if (toolId === 'borrar') return emit('reset')
  if (toolId === 'zoom') return emit('zoom')
  if (toolId === 'deshacer') return emit('undo')
  if (toolId === 'rehacer') return emit('redo')
}
</script>

<template>
  <aside
    aria-label="Herramientas del editor"
    class="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-3"
  >
    <button
      v-for="tool in tools"
      :key="tool.id"
      type="button"
      :class="[
        'flex w-full flex-col items-center gap-1 rounded-md border p-3 text-xs transition',
        tool.enabled
          ? 'border-primary bg-primary/10 text-primary shadow-orange'
          : 'cursor-not-allowed border-transparent text-text-muted opacity-30',
      ]"
      :disabled="!tool.enabled"
      :data-testid="`tool-${tool.id}`"
      @click="onToolClick(tool.id)"
    >
      <span
        class="text-xl"
        aria-hidden="true"
      >{{ tool.icon }}</span>
      <span class="text-center leading-tight">{{ tool.label }}</span>
      <span
        v-if="tool.sublabel"
        class="text-[10px] font-medium opacity-70"
      >{{ tool.sublabel }}</span>
    </button>
  </aside>
</template>
