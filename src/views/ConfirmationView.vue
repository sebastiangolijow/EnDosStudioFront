<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<template>
  <section class="mx-auto max-w-2xl px-6 py-16 text-center">
    <h1 class="text-h1 font-bold text-text">
      Pedido recibido 🔥
    </h1>
    <p class="mt-3 text-text-muted">
      Tu sticker está en revisión. Pedido <strong class="text-text">{{ route.params.uuid }}</strong>.
    </p>
    <p class="mt-2 text-text-muted">
      Pendiente — implementar en Fase 6.
    </p>
  </section>
</template>
