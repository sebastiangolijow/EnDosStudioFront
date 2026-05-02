<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface Props {
  file: File
  /** Pre-computed object URL (so the parent can manage lifetime if it wants).
   *  If not provided, FilePreview creates and revokes its own. */
  objectUrl?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  remove: []
}>()

/** Image natural dimensions, populated after load. */
const dimensions = ref<{ width: number; height: number } | null>(null)
const ownedUrl = ref<string | null>(null)

const url = computed(() => props.objectUrl ?? ownedUrl.value ?? '')

const sizeLabel = computed(() => {
  const bytes = props.file.size
  if (bytes < 1024) return `${bytes} B`
  const mb = bytes / 1024 / 1024
  if (mb < 1) return `${(bytes / 1024).toFixed(1)} KB`
  return `${mb.toFixed(1)} MB`
})

const dimensionsLabel = computed(() => {
  if (!dimensions.value) return '—'
  return `${dimensions.value.width} × ${dimensions.value.height} px`
})

onMounted(() => {
  // Manage our own object URL only if the parent didn't pass one in.
  if (!props.objectUrl) {
    ownedUrl.value = URL.createObjectURL(props.file)
  }

  // Probe the natural dimensions. We need a fresh Image() — the <img> in the
  // template will re-decode but we want the size before paint.
  const img = new Image()
  img.onload = () => {
    dimensions.value = { width: img.naturalWidth, height: img.naturalHeight }
  }
  img.src = url.value
})

onBeforeUnmount(() => {
  if (ownedUrl.value) {
    URL.revokeObjectURL(ownedUrl.value)
  }
})
</script>

<template>
  <div
    class="flex items-center gap-4 rounded-lg border border-success/50 bg-success/5 p-4"
    data-testid="file-preview"
  >
    <!-- Thumbnail -->
    <div class="size-24 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2">
      <img
        :src="url"
        :alt="file.name"
        class="size-full object-cover"
      >
    </div>

    <!-- Metadata -->
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span
          class="text-success"
          aria-hidden="true"
        >✓</span>
        <p class="truncate font-semibold text-text">
          {{ file.name }}
        </p>
      </div>
      <p class="mt-1 text-sm text-text-muted">
        {{ dimensionsLabel }}
      </p>
      <p class="text-sm text-text-muted">
        {{ sizeLabel }}
      </p>
    </div>

    <!-- Remove -->
    <button
      type="button"
      class="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted transition hover:border-error hover:text-error"
      data-testid="file-preview-remove"
      @click="emit('remove')"
    >
      Quitar
    </button>
  </div>
</template>
