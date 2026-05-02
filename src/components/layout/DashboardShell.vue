<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'

const route = useRoute()
const auth = useAuthStore()

const customerLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/upload', label: 'Nuevo sticker', icon: '＋' },
]

const adminLinks = [
  { to: '/admin/orders', label: 'Pedidos (admin)', icon: '📋' },
]

const links = computed(() => (auth.isAdmin ? [...customerLinks, ...adminLinks] : customerLinks))
</script>

<template>
  <div class="mx-auto grid max-w-7xl grid-cols-[240px_1fr] gap-6 px-6 py-6">
    <aside class="rounded-lg border border-border bg-surface-1 p-4">
      <nav
        aria-label="Navegación de cuenta"
        class="flex flex-col gap-1"
      >
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          :class="[
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
            route.path.startsWith(link.to)
              ? 'bg-primary/10 text-primary'
              : 'text-text-muted hover:bg-surface-2 hover:text-text',
          ]"
        >
          <span aria-hidden="true">{{ link.icon }}</span>
          <span>{{ link.label }}</span>
        </RouterLink>
      </nav>
    </aside>

    <main class="rounded-lg border border-border bg-surface-1 p-6">
      <slot />
    </main>
  </div>
</template>
