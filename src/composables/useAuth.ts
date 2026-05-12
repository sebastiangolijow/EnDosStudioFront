import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import type { AsyncStatus } from '@/types/api'
import type {
  LoginPayload,
  PasswordResetConfirmPayload,
  PasswordResetRequestPayload,
  RegisterPayload,
  SetPasswordPayload,
  User,
} from '@/types/auth'

export function useAuth() {
  const router = useRouter()
  const auth = useAuthStore()

  const status = ref<AsyncStatus>('idle')
  const error = ref<string | null>(null)

  async function login(payload: LoginPayload) {
    status.value = 'loading'
    error.value = null
    try {
      // 1. Get tokens
      const tokens = await authService.login(payload)
      // 2. Persist tokens before fetching user (the me() call needs them)
      auth.setSession({ user: {} as User, tokens })
      // 3. Now fetch the actual user
      const user = await authService.me()
      auth.setUser(user)
      status.value = 'success'
      // Staff (admin / shop_staff) land on the admin orders board;
      // customers go to the dashboard "Mis pedidos" view. A ?next=
      // query string from the login redirect still wins so deep links
      // survive the round-trip.
      const fallback = auth.isShopStaff ? '/admin/orders' : '/dashboard'
      const next = (router.currentRoute.value.query.next as string) || fallback
      router.push(next)
    } catch (e) {
      status.value = 'error'
      error.value = extractError(e)
      auth.clearSession()
    }
  }

  async function register(payload: RegisterPayload) {
    status.value = 'loading'
    error.value = null
    try {
      await authService.register(payload)
      status.value = 'success'
      // Backend created an inactive user + sent the verification email.
      // Do NOT auto-login — see CLAUDE.md "Customer registration creates inactive users".
    } catch (e) {
      status.value = 'error'
      error.value = extractError(e)
    }
  }

  async function setPassword(payload: SetPasswordPayload) {
    status.value = 'loading'
    error.value = null
    try {
      await authService.setPassword(payload)
      status.value = 'success'
      router.push({ name: 'login' })
    } catch (e) {
      status.value = 'error'
      error.value = extractError(e)
    }
  }

  async function requestPasswordReset(payload: PasswordResetRequestPayload) {
    status.value = 'loading'
    error.value = null
    try {
      await authService.passwordResetRequest(payload)
      status.value = 'success'
      // Backend always returns 200 (no enumeration). The UI should show a
      // generic "if the email exists, we sent a link" message regardless.
    } catch (e) {
      status.value = 'error'
      error.value = extractError(e)
    }
  }

  async function confirmPasswordReset(payload: PasswordResetConfirmPayload) {
    status.value = 'loading'
    error.value = null
    try {
      await authService.passwordResetConfirm(payload)
      status.value = 'success'
      router.push({ name: 'login' })
    } catch (e) {
      status.value = 'error'
      error.value = extractError(e)
    }
  }

  async function logout() {
    try {
      await authService.logout()
    } catch {
      // Even if logout fails server-side, clear the session locally.
    }
    auth.clearSession()
    router.push({ name: 'home' })
  }

  return {
    status,
    error,
    login,
    register,
    setPassword,
    requestPasswordReset,
    confirmPasswordReset,
    logout,
  }
}

function extractError(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    // axios error
    const r = (e as { response?: { data?: { detail?: string; message?: string } } }).response
    return r?.data?.detail ?? r?.data?.message ?? 'Algo salió mal. Intentá de nuevo.'
  }
  if (e instanceof Error) return e.message
  return 'Algo salió mal. Intentá de nuevo.'
}
