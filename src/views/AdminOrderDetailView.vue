<script setup lang="ts">
import { useRoute } from 'vue-router'
import DashboardShell from '@/components/layout/DashboardShell.vue'
const route = useRoute()
</script>

<template>
  <DashboardShell>
    <h1 class="text-h2 font-bold text-text">
      Pedido {{ route.params.uuid }}
    </h1>
    <p class="mt-2 text-text-muted">
      Pendiente — implementar en Fase 7.
    </p>
  </DashboardShell>
</template>
