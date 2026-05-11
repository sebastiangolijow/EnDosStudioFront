<script setup lang="ts">
/**
 * AppBottomSheet — slide-up overlay anchored to the bottom of the viewport.
 *
 * Used by the editor's mobile inspector: at < lg the inspector is too
 * tall to fit alongside the canvas, so it lives in a bottom sheet that
 * the customer opens to make their material/shape/relief choices.
 *
 * Differences from AppModal:
 *   - Anchored bottom (not centered)
 *   - Slides up on open, slides down on close (transform transition)
 *   - Caps height so the canvas above stays visible (max-h 80svh)
 *   - Drag handle at top (visual affordance — not draggable yet, but
 *     reads as a sheet not a modal)
 */
import { onMounted, onUnmounted, watch } from 'vue'

interface Props {
  open: boolean
  title?: string
  /** Closes when ESC is pressed or backdrop is clicked. */
  closeOnDismiss?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  closeOnDismiss: true,
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

// Prevent background scroll while sheet is open
watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="absolute inset-0 bg-black/70 backdrop-blur-sm"
          @click="closeOnDismiss && emit('close')"
        />
      </div>
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="open"
        class="fixed inset-x-0 bottom-0 z-50 flex max-h-[80svh] w-full flex-col rounded-t-2xl border-t border-border bg-surface-1 shadow-card"
      >
        <!-- Drag handle (visual only — sheet closes via backdrop / ✕ / ESC) -->
        <div class="flex justify-center pt-2">
          <span
            class="h-1.5 w-12 rounded-full bg-border"
            aria-hidden="true"
          />
        </div>
        <header class="flex items-center justify-between px-5 py-3">
          <h2 class="text-base font-semibold text-text">
            <slot name="header">
              {{ title }}
            </slot>
          </h2>
          <button
            v-if="closeOnDismiss"
            type="button"
            class="text-2xl leading-none text-text-muted hover:text-text"
            aria-label="Cerrar"
            data-testid="bottom-sheet-close"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>
        <!-- Scrollable body — overflow-y-auto so long inspector content
             can scroll within the sheet without breaking the sheet's
             height cap. -->
        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
