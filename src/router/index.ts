import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'

const routes: RouteRecordRaw[] = [
  // --- Public ---
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
  {
    path: '/catalogo',
    name: 'catalog',
    component: () => import('@/views/CatalogView.vue'),
  },
  {
    path: '/catalogo/:slug',
    name: 'catalog-detail',
    component: () => import('@/views/CatalogDetailView.vue'),
  },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
  { path: '/register', name: 'register', component: () => import('@/views/RegisterView.vue') },
  {
    path: '/set-password',
    name: 'set-password',
    component: () => import('@/views/SetPasswordView.vue'),
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/views/ForgotPasswordView.vue'),
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/views/ResetPasswordView.vue'),
  },

  // --- Authenticated customer ---
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/upload',
    name: 'upload',
    component: () => import('@/views/UploadView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // Authenticated editor — operates on a backend draft. PATCHes
    // material/shape/relief, uploads files, persists mask.
    path: '/editor/:uuid',
    name: 'editor',
    component: () => import('@/views/EditorView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // Anonymous "try before sign up" editor. No draft, no backend
    // mutations except the rate-limited /orders/smart-cut/ endpoint.
    // When the customer clicks "Material y tamaño" we auth-wall them
    // (they lose the editor state and restart on register — see the
    // design discussion that landed this route).
    path: '/editor',
    name: 'editor-anonymous',
    component: () => import('@/views/EditorView.vue'),
  },
  {
    path: '/preview',
    name: 'preview',
    component: () => import('@/views/PreviewView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/order-config/:uuid',
    name: 'order-config',
    component: () => import('@/views/OrderConfigView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/checkout/:uuid',
    name: 'checkout',
    component: () => import('@/views/CheckoutView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/confirmation/:uuid',
    name: 'confirmation',
    component: () => import('@/views/ConfirmationView.vue'),
    meta: { requiresAuth: true },
  },

  // --- Admin orders (staff: admin OR shop_staff) ---
  // Mirrors the backend's _is_staff permission used by start-production /
  // ship / mark-paid. Originally requiresAdmin (admin-only) but that was
  // inconsistent with the backend; shop_staff employees need to manage
  // the print queue without being full admins.
  {
    path: '/admin/orders',
    name: 'admin-orders',
    component: () => import('@/views/AdminOrdersView.vue'),
    meta: { requiresAuth: true, requiresStaff: true },
  },
  {
    path: '/admin/orders/:uuid',
    name: 'admin-order-detail',
    component: () => import('@/views/AdminOrderDetailView.vue'),
    meta: { requiresAuth: true, requiresStaff: true },
  },

  // --- Catalog admin (M3a) — staff (admin OR shop_staff) ---
  {
    path: '/admin/products',
    name: 'admin-products',
    component: () => import('@/views/AdminProductsView.vue'),
    meta: { requiresAuth: true, requiresStaff: true },
  },
  {
    path: '/admin/products/new',
    name: 'admin-product-new',
    component: () => import('@/views/AdminProductFormView.vue'),
    meta: { requiresAuth: true, requiresStaff: true },
  },
  {
    path: '/admin/products/:slug/edit',
    name: 'admin-product-edit',
    component: () => import('@/views/AdminProductFormView.vue'),
    meta: { requiresAuth: true, requiresStaff: true },
  },

  // Reservation whitelist management. Staff toggle can_reserve_orders
  // per user — gates the "Reservar y pagar en tienda" CTA at checkout.
  {
    path: '/admin/users',
    name: 'admin-users',
    component: () => import('@/views/AdminUsersView.vue'),
    meta: { requiresAuth: true, requiresStaff: true },
  },

  // Promo code management. Staff create / disable discount codes
  // customers redeem at checkout.
  {
    path: '/admin/discounts',
    name: 'admin-discounts',
    component: () => import('@/views/AdminDiscountsView.vue'),
    meta: { requiresAuth: true, requiresStaff: true },
  },

  // --- Catch-all ---
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to) {
    // Honor hash anchors (e.g. /#how, /#inspiration from the header nav)
    // so clicking those links smooth-scrolls to the matching section.
    // The 88 px top offset matches the sticky AppHeader's height — the
    // section's title would otherwise hide under it.
    if (to.hash) {
      return {
        el: to.hash,
        top: 88,
        behavior: 'smooth',
      }
    }
    return { top: 0 }
  },
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { next: to.fullPath } }
  }

  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'home' }
  }

  if (to.meta.requiresStaff && !auth.isShopStaff) {
    return { name: 'home' }
  }

  // Staff shouldn't see the customer "Mis pedidos" view — they don't
  // place customer orders. Bounce them to the admin orders screen.
  if (to.name === 'dashboard' && auth.isShopStaff) {
    return { name: 'admin-orders' }
  }

  if ((to.name === 'login' || to.name === 'register') && auth.isAuthenticated) {
    return { name: auth.isShopStaff ? 'admin-orders' : 'dashboard' }
  }

  return true
})

export default router
