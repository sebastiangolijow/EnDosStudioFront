<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useAuth } from '@/composables/useAuth'

const route = useRoute()
const auth = useAuthStore()
const { logout } = useAuth()

/**
 * Sidebar items per the mockup. The four "Mis diseños / Direcciones /
 * Métodos de pago / Configuración" entries are POST-MVP — they currently
 * route to /dashboard so clicking them keeps the customer on a sane screen
 * instead of breaking. Wire each to a real view when its feature lands.
 *
 * `disabled: true` means the link renders muted and is non-interactive,
 * matching the "this works, the rest is coming soon" UX intent.
 */
interface NavLink {
  to: string
  label: string
  icon: string
  disabled?: boolean
}

const customerLinks: NavLink[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/dashboard', label: 'Mis pedidos', icon: '📦' },
  { to: '/dashboard', label: 'Mis diseños', icon: '🎨', disabled: true },
  { to: '/dashboard', label: 'Direcciones', icon: '📍', disabled: true },
  { to: '/dashboard', label: 'Métodos de pago', icon: '💳', disabled: true },
  { to: '/dashboard', label: 'Configuración', icon: '⚙️', disabled: true },
]

const adminLinks: NavLink[] = [
  { to: '/admin/orders', label: 'Pedidos (admin)', icon: '📋' },
  { to: '/admin/products', label: 'Productos', icon: '🛍️' },
  { to: '/admin/users', label: 'Usuarios', icon: '👥' },
  { to: '/admin/discounts', label: 'Descuentos', icon: '🎟️' },
]

// Visible to both admin and shop_staff — same set the backend uses for
// staff-only endpoints (admin OR shop_staff). Was `isAdmin` only, which
// hid the orders/products screens from shop_staff employees even though
// the backend would have authorized them.
const links = computed(() =>
  auth.isShopStaff ? [...customerLinks, ...adminLinks] : customerLinks,
)

function isActive(link: NavLink): boolean {
  if (link.disabled) return false
  return route.path === link.to || route.path.startsWith(link.to + '/')
}
</script>

<template>
  <div class="mx-auto grid max-w-7xl grid-cols-[240px_1fr] gap-6 px-6 py-6">
    <aside class="self-start rounded-lg border border-border bg-surface-1 p-4">
      <nav
        aria-label="Navegación de cuenta"
        class="flex flex-col gap-1"
      >
        <RouterLink
          v-for="link in links"
          :key="link.label"
          :to="link.to"
          :class="[
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
            link.disabled
              ? 'cursor-not-allowed opacity-40'
              : isActive(link)
                ? 'bg-primary/10 text-primary'
                : 'text-text-muted hover:bg-surface-2 hover:text-text',
          ]"
          :aria-disabled="link.disabled"
          :tabindex="link.disabled ? -1 : 0"
          @click="link.disabled && $event.preventDefault()"
        >
          <span aria-hidden="true">{{ link.icon }}</span>
          <span>{{ link.label }}</span>
        </RouterLink>

        <!-- Logout — separate from the nav links because it's an action, not a route -->
        <button
          class="mt-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-muted transition hover:bg-surface-2 hover:text-text"
          type="button"
          @click="logout"
        >
          <span aria-hidden="true">🚪</span>
          <span>Cerrar sesión</span>
        </button>
      </nav>
    </aside>

    <main class="rounded-lg border border-border bg-surface-1 p-6">
      <slot />
    </main>
  </div>
</template>
