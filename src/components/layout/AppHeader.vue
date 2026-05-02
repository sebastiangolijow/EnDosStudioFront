<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useAuth } from '@/composables/useAuth'
import AppButton from '@/components/ui/AppButton.vue'

const auth = useAuthStore()
const router = useRouter()
const { logout } = useAuth()

const navLinks = computed(() => [
  { to: '/', label: 'Productos' },
  { to: '/#how', label: 'Cómo funciona' },
  { to: '/#materials', label: 'Materiales' },
  { to: '/#inspiration', label: 'Inspiración' },
])
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
    <div class="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-6">
      <RouterLink
        to="/"
        class="flex items-center gap-2"
      >
        <span class="rounded bg-primary px-2 py-1 text-sm font-bold tracking-tight text-white">
          EN DOS
        </span>
      </RouterLink>

      <nav
        class="hidden items-center gap-6 md:flex"
        aria-label="Navegación principal"
      >
        <RouterLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="text-sm text-text-muted hover:text-text"
        >
          {{ link.label }}
        </RouterLink>
      </nav>

      <div class="flex items-center gap-3">
        <template v-if="!auth.isAuthenticated">
          <RouterLink
            to="/login"
            class="text-sm text-text-muted hover:text-text"
          >
            Iniciar sesión
          </RouterLink>
          <AppButton
            size="sm"
            @click="router.push('/register')"
          >
            Registrarse
          </AppButton>
        </template>
        <template v-else>
          <RouterLink
            to="/dashboard"
            class="text-sm text-text-muted hover:text-text"
          >
            Mi cuenta
          </RouterLink>
          <AppButton
            variant="ghost"
            size="sm"
            @click="logout"
          >
            Salir
          </AppButton>
        </template>
      </div>
    </div>
  </header>
</template>
