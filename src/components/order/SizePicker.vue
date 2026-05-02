<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DIMENSION_STEP_MM, MIN_DIMENSION_MM } from '@/types/order'

interface Props {
  widthMm: number
  heightMm: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:widthMm': [value: number]
  'update:heightMm': [value: number]
}>()

/**
 * Preset square sizes (in mm). 5/7/10/15 cm matches the design pack.
 */
const PRESETS_MM = [50, 70, 100, 150]

const isCustom = ref(props.widthMm > 0 && !PRESETS_MM.includes(props.widthMm) && !PRESETS_MM.includes(props.heightMm))

/** Local mirrors of the inputs — only emit on blur so the user can type freely. */
const widthInput = ref<number>(props.widthMm || MIN_DIMENSION_MM)
const heightInput = ref<number>(props.heightMm || MIN_DIMENSION_MM)

watch(
  () => [props.widthMm, props.heightMm],
  ([w, h]) => {
    if (w !== widthInput.value) widthInput.value = w
    if (h !== heightInput.value) heightInput.value = h
  },
)

const activePreset = computed<number | null>(() => {
  if (isCustom.value) return null
  if (props.widthMm === props.heightMm && PRESETS_MM.includes(props.widthMm)) {
    return props.widthMm
  }
  return null
})

function pickPreset(mm: number) {
  isCustom.value = false
  emit('update:widthMm', mm)
  emit('update:heightMm', mm)
}

function pickCustom() {
  isCustom.value = true
  // Keep the current values, just reveal the inputs
}

/** Snap a value to the nearest valid dimension (≥ MIN, multiple of STEP). */
function snap(value: number): number {
  const clamped = Math.max(MIN_DIMENSION_MM, Math.round(value))
  const remainder = clamped % DIMENSION_STEP_MM
  if (remainder === 0) return clamped
  // Round to the nearest step
  return remainder < DIMENSION_STEP_MM / 2
    ? clamped - remainder
    : clamped + (DIMENSION_STEP_MM - remainder)
}

function onWidthBlur() {
  const snapped = snap(widthInput.value)
  widthInput.value = snapped
  emit('update:widthMm', snapped)
}

function onHeightBlur() {
  const snapped = snap(heightInput.value)
  heightInput.value = snapped
  emit('update:heightMm', snapped)
}
</script>

<template>
  <div>
    <!-- Preset pills + custom -->
    <div
      role="radiogroup"
      aria-label="Tamaño del sticker"
      class="flex flex-wrap gap-2"
    >
      <button
        v-for="mm in PRESETS_MM"
        :key="mm"
        type="button"
        role="radio"
        :aria-checked="activePreset === mm"
        :class="[
          'rounded-full border px-4 py-2 text-sm transition',
          activePreset === mm
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-surface-2 text-text-muted hover:bg-surface-1 hover:text-text',
        ]"
        :data-testid="`size-${mm}`"
        @click="pickPreset(mm)"
      >
        {{ mm / 10 }} cm
      </button>
      <button
        type="button"
        role="radio"
        :aria-checked="isCustom"
        :class="[
          'rounded-full border px-4 py-2 text-sm transition',
          isCustom
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-surface-2 text-text-muted hover:bg-surface-1 hover:text-text',
        ]"
        data-testid="size-custom"
        @click="pickCustom"
      >
        Personalizado
      </button>
    </div>

    <!-- Custom inputs (only when "Personalizado") -->
    <div
      v-if="isCustom"
      class="mt-4 flex flex-wrap items-center gap-3"
    >
      <label class="flex items-center gap-2 text-sm text-text">
        Ancho:
        <input
          v-model.number="widthInput"
          type="number"
          :min="MIN_DIMENSION_MM"
          :step="DIMENSION_STEP_MM"
          class="h-10 w-20 rounded-sm border border-border bg-surface-1 px-2 text-text focus-visible:border-primary focus-visible:outline-none"
          data-testid="size-width-mm"
          @blur="onWidthBlur"
        >
        <span class="text-text-muted">mm</span>
      </label>
      <label class="flex items-center gap-2 text-sm text-text">
        Alto:
        <input
          v-model.number="heightInput"
          type="number"
          :min="MIN_DIMENSION_MM"
          :step="DIMENSION_STEP_MM"
          class="h-10 w-20 rounded-sm border border-border bg-surface-1 px-2 text-text focus-visible:border-primary focus-visible:outline-none"
          data-testid="size-height-mm"
          @blur="onHeightBlur"
        >
        <span class="text-text-muted">mm</span>
      </label>
      <p class="text-xs text-text-muted">
        Múltiplos de {{ DIMENSION_STEP_MM }} mm, mínimo {{ MIN_DIMENSION_MM }} mm
      </p>
    </div>
  </div>
</template>
