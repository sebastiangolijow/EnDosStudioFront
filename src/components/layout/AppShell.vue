<script setup lang="ts">
import AppHeader from './AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
</script>

<template>
  <div class="flex min-h-screen flex-col bg-bg text-text">
    <AppHeader />
    <main class="flex-1">
      <slot />
    </main>
    <AppToast />
  </div>
</template>
