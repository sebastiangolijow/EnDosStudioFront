<script setup lang="ts">
/**
 * Legacy upload page → redirect stub.
 *
 * Customers no longer go through a dedicated upload screen — they
 * land directly in the editor where the empty state shows the
 * dropzone (see HomeView's "Subir mi diseño" → useNewSticker).
 *
 * This file stays around so any external link or browser bookmark
 * pointing at /upload still works: we create a fresh draft and
 * route into the editor's empty state.
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useNewSticker } from '@/composables/useNewSticker'

const router = useRouter()
const { startNewSticker } = useNewSticker()
const isRedirecting = ref<boolean>(true)

onMounted(async () => {
  // startNewSticker handles the create + route. Returns false (and
  // toasts) if the backend rejected — fall the customer back to the
  // dashboard instead of leaving them staring at the spinner.
  const ok = await startNewSticker()
  if (!ok) {
    router.replace({ name: 'dashboard' })
  }
  isRedirecting.value = false
})
</script>

<template>
  <section class="flex min-h-[calc(100svh-88px)] items-center justify-center px-8">
    <div class="text-center">
      <p class="text-text">
        Cargando…
      </p>
    </div>
  </section>
</template>
