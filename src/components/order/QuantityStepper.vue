<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MAX_QUANTITY, MIN_QUANTITY } from '@/types/order'

interface Props {
  modelValue: number
  /** Step amount applied by the +/- buttons. Default 5 — typing in the input
   *  is unconstrained, but blur snaps to the nearest valid value. */
  step?: number
}

const props = withDefaults(defineProps<Props>(), {
  step: 5,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const local = ref<number>(props.modelValue)

watch(
  () => props.modelValue,
  (v) => {
    if (v !== local.value) local.value = v
  },
)

const canDecrease = computed(() => props.modelValue > MIN_QUANTITY)
const canIncrease = computed(() => props.modelValue < MAX_QUANTITY)

function clamp(value: number): number {
  return Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, Math.round(value)))
}

function decrease() {
  if (!canDecrease.value) return
  emit('update:modelValue', clamp(props.modelValue - props.step))
}

function increase() {
  if (!canIncrease.value) return
  emit('update:modelValue', clamp(props.modelValue + props.step))
}

function onInputBlur() {
  const clamped = clamp(local.value)
  local.value = clamped
  emit('update:modelValue', clamped)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="flex size-10 items-center justify-center rounded-md border border-border bg-surface-2 text-text-muted transition hover:bg-surface-1 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="!canDecrease"
      aria-label="Disminuir cantidad"
      data-testid="quantity-decrease"
      @click="decrease"
    >
      −
    </button>
    <input
      v-model.number="local"
      type="number"
      :min="MIN_QUANTITY"
      :max="MAX_QUANTITY"
      :step="step"
      class="h-10 w-24 rounded-md border border-border bg-surface-1 px-3 text-center text-text focus-visible:border-primary focus-visible:outline-none"
      data-testid="quantity-input"
      @blur="onInputBlur"
    >
    <button
      type="button"
      class="flex size-10 items-center justify-center rounded-md border border-border bg-surface-2 text-text-muted transition hover:bg-surface-1 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="!canIncrease"
      aria-label="Aumentar cantidad"
      data-testid="quantity-increase"
      @click="increase"
    >
      +
    </button>
    <span class="text-sm text-text-muted">unidades (mín. {{ MIN_QUANTITY }})</span>
  </div>
</template>
