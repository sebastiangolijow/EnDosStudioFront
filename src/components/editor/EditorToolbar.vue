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
}

const props = defineProps<Props>()

defineEmits<{
  'auto-cut': []
}>()

// Auto cut is meaningful only for `contorneado` — for geometric shapes
// the mask is a fixed primitive, so the button is disabled (and visually
// muted) to avoid implying it does something.
const autoCutDisabled = computed(
  () => props.isProcessing || !props.isOpenCvReady || props.shape !== 'contorneado',
)

/**
 * Tools shown in the toolbar. Per the M2 scope decision (CLAUDE.md "Relief
 * feature scope (M2)"), drawn relief is OUT of MVP — relief is an Inspector
 * checkbox + free-text note instead of a draw-on-canvas tool. The remaining
 * stub buttons preview where future tools will live.
 */
const tools = [
  { id: 'auto-cut',  icon: '✂️',  label: 'Auto cut',  active: true,  disabled: false },
  { id: 'borrar',    icon: '🧽',  label: 'Borrar',    active: false, disabled: true },
  { id: 'zoom',      icon: '🔍',  label: 'Zoom',      active: false, disabled: true },
  { id: 'deshacer',  icon: '↶',   label: 'Deshacer',  active: false, disabled: true },
  { id: 'rehacer',   icon: '↷',   label: 'Rehacer',   active: false, disabled: true },
]
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
        tool.active
          ? 'border-primary bg-primary/10 text-primary shadow-orange'
          : 'border-transparent text-text-muted hover:bg-surface-2 hover:text-text',
        tool.disabled && 'cursor-not-allowed opacity-30',
      ]"
      :disabled="tool.disabled || (tool.id === 'auto-cut' && autoCutDisabled)"
      :data-testid="`tool-${tool.id}`"
      @click="tool.id === 'auto-cut' && $emit('auto-cut')"
    >
      <span
        class="text-xl"
        aria-hidden="true"
      >{{ tool.icon }}</span>
      <span class="text-center leading-tight">{{ tool.label }}</span>
    </button>
  </aside>
</template>
