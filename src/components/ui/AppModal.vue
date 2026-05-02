<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

interface Props {
  open: boolean
  title?: string
  /** Closes when ESC is pressed or backdrop is clicked. Set to false for force-acknowledge modals. */
  closeOnDismiss?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  closeOnDismiss: true,
  size: 'md',
})

const emit = defineEmits<{
  close: []
}>()

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && props.closeOnDismiss) {
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// Prevent background scroll while modal is open
watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="absolute inset-0 bg-black/70 backdrop-blur-sm"
        @click="closeOnDismiss && emit('close')"
      />
      <div
        :class="[
          'relative w-full rounded-xl border border-border bg-surface-1 p-6 shadow-card',
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl',
        ]"
      >
        <header
          v-if="title || $slots.header"
          class="mb-4 flex items-center justify-between"
        >
          <h2 class="text-h3 font-semibold text-text">
            <slot name="header">
              {{ title }}
            </slot>
          </h2>
          <button
            v-if="closeOnDismiss"
            class="text-text-muted hover:text-text"
            aria-label="Cerrar"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>
        <div class="text-text">
          <slot />
        </div>
        <footer
          v-if="$slots.footer"
          class="mt-6 flex justify-end gap-3"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
