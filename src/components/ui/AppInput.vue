<script setup lang="ts">
import { computed, useId } from 'vue'

interface Props {
  modelValue: string
  label?: string
  type?: string
  placeholder?: string
  helper?: string
  error?: string
  disabled?: boolean
  required?: boolean
  autocomplete?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  label: '',
  placeholder: '',
  helper: '',
  error: '',
  disabled: false,
  required: false,
  autocomplete: 'off',
})

defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputId = useId()
const helperId = computed(() => `${inputId}-helper`)
const errorId = computed(() => `${inputId}-error`)

const inputClasses = computed(() =>
  [
    'h-11 w-full rounded-sm bg-surface-1 px-4 text-base text-text',
    'border transition placeholder:text-text-muted',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    props.error
      ? 'border-error focus-visible:ring-error'
      : 'border-border focus-visible:ring-primary focus-visible:border-primary',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' '),
)
</script>

<template>
  <label
    :for="inputId"
    class="block"
  >
    <span
      v-if="label"
      class="mb-1 block text-sm font-medium text-text"
    >{{ label }}</span>
    <input
      :id="inputId"
      :class="inputClasses"
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :autocomplete="autocomplete"
      :aria-describedby="error ? errorId : helper ? helperId : undefined"
      :aria-invalid="!!error"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
    <p
      v-if="error"
      :id="errorId"
      class="mt-1 text-sm text-error"
    >{{ error }}</p>
    <p
      v-else-if="helper"
      :id="helperId"
      class="mt-1 text-sm text-text-muted"
    >{{ helper }}</p>
  </label>
</template>
