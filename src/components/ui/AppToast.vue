<script setup lang="ts">
import { useUIStore, type ToastVariant } from '@/stores/ui.store'

const ui = useUIStore()

const variantClasses: Record<ToastVariant, string> = {
  info: 'bg-surface-2 text-text border-border',
  success: 'bg-success/10 text-success border-success/40',
  warning: 'bg-warning/10 text-warning border-warning/40',
  error: 'bg-error/10 text-error border-error/40',
}
</script>

<template>
  <!-- top-20 / md:top-24 keep the toast below the sticky AppHeader
       (h-16 mobile / h-[88px] desktop). Earlier value of top-4 collided
       with the header content (Mi cuenta / Salir links). -->
  <div
    class="fixed right-4 top-20 z-[60] flex w-full max-w-sm flex-col gap-2 md:top-24"
    aria-live="polite"
  >
    <div
      v-for="toast in ui.toasts"
      :key="toast.id"
      :class="[
        'flex items-start gap-3 rounded-md border px-4 py-3 shadow-card',
        variantClasses[toast.variant],
      ]"
      role="status"
    >
      <p class="flex-1 text-sm">
        {{ toast.message }}
      </p>
      <button
        class="text-current opacity-60 hover:opacity-100"
        aria-label="Cerrar"
        @click="ui.dismissToast(toast.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>
