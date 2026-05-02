import api from './api'
import type {
  AuthTokens,
  LoginPayload,
  PasswordResetConfirmPayload,
  PasswordResetRequestPayload,
  RegisterPayload,
  SetPasswordPayload,
  User,
} from '@/types/auth'

function normalizeTokens(data: {
  access?: string
  refresh?: string
  access_token?: string
  refresh_token?: string
}): AuthTokens {
  return {
    access: data.access ?? data.access_token ?? '',
    refresh: data.refresh ?? data.refresh_token ?? '',
  }
}

export const authService = {
  /**
   * Returns the JWT pair. The caller (useAuth) MUST then fetch the user via
   * me() and combine — the login response does NOT include the user object.
   */
  async login(payload: LoginPayload): Promise<AuthTokens> {
    const response = await api.post('/auth/login/', payload)
    return normalizeTokens(response.data)
  },

  /**
   * Backend creates inactive user + sends verification email. Returns 200
   * regardless of whether the email already exists (no leak). The customer
   * MUST hit /set-password/ from the email link before they can log in.
   */
  async register(payload: RegisterPayload): Promise<void> {
    await api.post('/auth/register/', payload)
  },

  async logout(): Promise<void> {
    await api.post('/auth/logout/')
  },

  /** GET /users/me/ — current user profile. Replaces the old /auth/me/. */
  async me(): Promise<User> {
    const response = await api.get('/users/me/')
    return response.data
  },

  /**
   * Activate the account from the verification email link.
   * Customer types a password; backend marks user verified + active +
   * creates the allauth EmailAddress row (without that row, login silently
   * fails — backend handles it).
   */
  async setPassword(payload: SetPasswordPayload): Promise<void> {
    await api.post('/users/set-password/', payload)
  },

  // === Forgot-password flow ===

  /**
   * Sends the reset email. Backend always returns 200 — no enumeration.
   * The link in the email points at this frontend's /reset-password page.
   */
  async passwordResetRequest(payload: PasswordResetRequestPayload): Promise<void> {
    await api.post('/auth/password/reset/', payload)
  },

  /** Confirms the new password. Frontend supplies uid + token from URL query string. */
  async passwordResetConfirm(payload: PasswordResetConfirmPayload): Promise<void> {
    await api.post('/auth/password/reset/confirm/', payload)
  },
}
