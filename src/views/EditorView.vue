<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<template>
  <section class="mx-auto max-w-7xl px-6 py-12">
    <h1 class="text-h1 font-bold text-text">
      Editor de sticker
    </h1>
    <p class="mt-2 text-text-muted">
      Pendiente — implementar en Fases 3-5. Order: {{ route.params.uuid }}
    </p>
  </section>
</template>
