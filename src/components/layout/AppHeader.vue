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
  { to: '/#inspiration', label: 'Inspiración' },
])
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
    <!-- Header bar — shrinks at narrow widths (px-4 on mobile vs px-8+
         on desktop) so the logo + auth controls don't crowd. The
         middle nav is hidden < md anyway. -->
    <div class="flex h-16 items-center justify-between px-4 md:h-[88px] md:px-12 lg:px-16">
      <RouterLink
        to="/"
        class="flex items-center gap-2"
      >
        <span class="rounded-md bg-primary px-2.5 py-1 text-base font-bold tracking-tight text-white md:px-3 md:py-1.5 md:text-lg">
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

      <div class="flex items-center gap-2 md:gap-4">
        <template v-if="!auth.isAuthenticated">
          <!-- "Iniciar sesión" text link hidden on mobile to save space;
               the Registrarse CTA is what gets new visitors moving, and
               existing users go straight to login from there. -->
          <RouterLink
            to="/login"
            class="hidden text-base font-medium text-text-muted hover:text-text md:inline"
          >
            Iniciar sesión
          </RouterLink>
          <AppButton
            size="sm"
            class="md:!h-11 md:!px-5 md:!text-base"
            @click="router.push('/register')"
          >
            Registrarse
          </AppButton>
        </template>
        <template v-else>
          <!-- "Mi cuenta" hidden on mobile; logged-in customers can reach
               the dashboard via the logo or a future hamburger menu. The
               Salir button stays visible so anyone can log out from any
               screen.

               Staff (admin / shop_staff) see "Panel admin" → /admin/orders
               instead. They don't have a customer "Mis pedidos" view —
               they're not buying. -->
          <RouterLink
            :to="auth.isShopStaff ? '/admin/orders' : '/dashboard'"
            class="hidden text-base font-medium text-text-muted hover:text-text md:inline"
          >
            {{ auth.isShopStaff ? 'Panel admin' : 'Mi cuenta' }}
          </RouterLink>
          <AppButton
            variant="ghost"
            size="sm"
            class="md:!h-11 md:!px-5 md:!text-base"
            @click="logout"
          >
            Salir
          </AppButton>
        </template>
      </div>
    </div>
  </header>
</template>
