import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/auth.store'
import router from '@/router'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // 30s default — Stripe callbacks + file uploads can override per-request
  timeout: 30000,
})

// === Request interceptor: attach access token ===
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const auth = useAuthStore()
  if (auth.tokens?.access) {
    config.headers.Authorization = `Bearer ${auth.tokens.access}`
  }
  return config
})

// === Response interceptor: refresh on 401, then retry once ===
let refreshing: Promise<string> | null = null

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined
    const auth = useAuthStore()

    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      auth.tokens?.refresh
    ) {
      original._retried = true

      try {
        // De-dupe: many concurrent 401s share one refresh attempt.
        refreshing = refreshing ?? requestNewAccessToken(auth.tokens.refresh)
        const newAccess = await refreshing
        refreshing = null

        if (auth.tokens) {
          auth.tokens.access = newAccess
          localStorage.setItem('endos.access', newAccess)
        }

        original.headers = original.headers ?? {}
        original.headers.Authorization = `Bearer ${newAccess}`
        return api.request(original)
      } catch {
        refreshing = null
        auth.clearSession()
        router.push({ name: 'login' })
        return Promise.reject(error)
      }
    }

    return Promise.reject(error)
  },
)

async function requestNewAccessToken(refresh: string): Promise<string> {
  // Use a bare axios call (NOT `api`) to avoid recursive interceptor loops.
  // Path is relative to VITE_API_BASE_URL which already includes /api/v1.
  const response = await axios.post(`${import.meta.env.VITE_API_BASE_URL}/auth/token/refresh/`, {
    refresh,
  })
  // dj-rest-auth versions vary: some return `access`, some `access_token`.
  return response.data.access ?? response.data.access_token
}

export default api
