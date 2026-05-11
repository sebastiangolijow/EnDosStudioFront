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
  { to: '/catalogo', label: 'Catálogo' },
  { to: '/#how', label: 'Cómo funciona' },
  { to: '/#materials', label: 'Materiales' },
  { to: '/#inspiration', label: 'Inspiración' },
])
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
    <div class="flex h-[88px] items-center justify-between px-8 md:px-12 lg:px-16">
      <RouterLink
        to="/"
        class="flex items-center gap-2"
      >
        <span class="rounded-md bg-primary px-3 py-1.5 text-lg font-bold tracking-tight text-white">
          EN DOS
        </span>
      </RouterLink>

      <nav
        class="hidden items-center gap-8 md:flex"
        aria-label="Navegación principal"
      >
        <RouterLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="text-base font-medium text-text-muted transition hover:text-text"
        >
          {{ link.label }}
        </RouterLink>
      </nav>

      <div class="flex items-center gap-4">
        <template v-if="!auth.isAuthenticated">
          <RouterLink
            to="/login"
            class="text-base font-medium text-text-muted hover:text-text"
          >
            Iniciar sesión
          </RouterLink>
          <AppButton
            size="md"
            @click="router.push('/register')"
          >
            Registrarse
          </AppButton>
        </template>
        <template v-else>
          <RouterLink
            to="/dashboard"
            class="text-base font-medium text-text-muted hover:text-text"
          >
            Mi cuenta
          </RouterLink>
          <AppButton
            variant="ghost"
            size="md"
            @click="logout"
          >
            Salir
          </AppButton>
        </template>
      </div>
    </div>
  </header>
</template>
