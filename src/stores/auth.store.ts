import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AsyncStatus } from '@/types/api'
import type { AuthTokens, User } from '@/types/auth'

const ACCESS_KEY = 'endos.access'
const REFRESH_KEY = 'endos.refresh'
const USER_KEY = 'endos.user'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(loadJson(USER_KEY))
  const tokens = ref<AuthTokens | null>(loadTokens())
  const status = ref<AsyncStatus>('idle')
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!tokens.value?.access && !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isShopStaff = computed(
    () => user.value?.role === 'shop_staff' || user.value?.role === 'admin',
  )

  function setSession(payload: { user: User; tokens: AuthTokens }) {
    user.value = payload.user
    tokens.value = payload.tokens
    localStorage.setItem(ACCESS_KEY, payload.tokens.access)
    localStorage.setItem(REFRESH_KEY, payload.tokens.refresh)
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user))
  }

  function setUser(u: User) {
    user.value = u
    localStorage.setItem(USER_KEY, JSON.stringify(u))
  }

  function clearSession() {
    user.value = null
    tokens.value = null
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
  }

  return {
    user,
    tokens,
    status,
    error,
    isAuthenticated,
    isAdmin,
    isShopStaff,
    setSession,
    setUser,
    clearSession,
  }
})

// --- helpers (kept private to this module) ---
function loadTokens(): AuthTokens | null {
  const access = localStorage.getItem(ACCESS_KEY)
  const refresh = localStorage.getItem(REFRESH_KEY)
  if (!access || !refresh) return null
  return { access, refresh }
}

function loadJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
