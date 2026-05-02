import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'

const routes: RouteRecordRaw[] = [
  // --- Public ---
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
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
    // Order UUID is required once a draft has been created server-side; before
    // that the editor lives on /upload. Keeping :uuid required avoids the
    // foot-gun of editing without a backed order to attach files to.
    path: '/editor/:uuid',
    name: 'editor',
    component: () => import('@/views/EditorView.vue'),
    meta: { requiresAuth: true },
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

  // --- Admin (M2: Django admin covers ops; these views are post-MVP shells) ---
  {
    path: '/admin/orders',
    name: 'admin-orders',
    component: () => import('@/views/AdminOrdersView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/admin/orders/:uuid',
    name: 'admin-order-detail',
    component: () => import('@/views/AdminOrderDetailView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },

  // --- Catch-all ---
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
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

  if ((to.name === 'login' || to.name === 'register') && auth.isAuthenticated) {
    return { name: 'dashboard' }
  }

  return true
})

export default router
