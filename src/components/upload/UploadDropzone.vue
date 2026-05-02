<script setup lang="ts">
import { computed, ref } from 'vue'

interface Props {
  /** Comma-separated MIME types or extensions, passed straight to <input accept>. */
  accept?: string
  /** Max file size in bytes. Files over this are rejected client-side. */
  maxSizeBytes?: number
}

const props = withDefaults(defineProps<Props>(), {
  accept: 'image/png,image/jpeg,image/webp',
  maxSizeBytes: 25 * 1024 * 1024,
})

const emit = defineEmits<{
  'file-selected': [file: File]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const error = ref<string | null>(null)

const acceptedFormatsLabel = computed(() => {
  const map: Record<string, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPG',
    'image/webp': 'WEBP',
  }
  return props.accept
    .split(',')
    .map((m) => map[m.trim()] ?? m.trim())
    .join(', ')
})

const maxSizeLabel = computed(() => `${Math.round(props.maxSizeBytes / 1024 / 1024)}MB`)

function validate(file: File): string | null {
  // Validate type — the input's accept attr is hint-only, browsers don't enforce
  if (!props.accept.split(',').some((m) => file.type === m.trim())) {
    return `Formato no soportado. Aceptamos ${acceptedFormatsLabel.value}.`
  }
  if (file.size > props.maxSizeBytes) {
    return `El archivo supera el máximo de ${maxSizeLabel.value}.`
  }
  return null
}

function handleFile(file: File) {
  const err = validate(file)
  if (err) {
    error.value = err
    return
  }
  error.value = null
  emit('file-selected', file)
}

function onClick() {
  fileInput.value?.click()
}

function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) handleFile(file)
  // Allow re-picking the same file: clear the input value
  target.value = ''
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  isDragging.value = true
}

function onDragLeave() {
  isDragging.value = false
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}

const wrapperClasses = computed(() =>
  [
    'relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition cursor-pointer',
    error.value
      ? 'border-error bg-error/5'
      : isDragging.value
        ? 'border-primary bg-primary/5 shadow-orange'
        : 'border-border bg-surface-2 hover:border-text-muted hover:bg-surface-1',
  ].join(' '),
)
</script>

<template>
  <div>
    <div
      :class="wrapperClasses"
      role="button"
      tabindex="0"
      data-testid="upload-dropzone"
      :aria-label="'Subí tu diseño'"
      @click="onClick"
      @keydown.enter.space.prevent="onClick"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <span
        class="text-4xl"
        aria-hidden="true"
      >📤</span>
      <p class="text-lg font-semibold text-text">
        Arrastrá tu diseño aquí
      </p>
      <p class="text-sm text-primary hover:underline">
        o hacé clic para seleccionar
      </p>
      <p class="mt-2 text-xs text-text-muted">
        Formatos aceptados: {{ acceptedFormatsLabel }}
      </p>
      <p class="text-xs text-text-muted">
        Tamaño máximo: {{ maxSizeLabel }}
      </p>

      <input
        ref="fileInput"
        type="file"
        :accept="accept"
        class="hidden"
        data-testid="upload-input"
        @change="onChange"
      >
    </div>

    <p
      v-if="error"
      class="mt-2 text-sm text-error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>
