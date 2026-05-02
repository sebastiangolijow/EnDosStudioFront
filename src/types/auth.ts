export type UserRole = 'admin' | 'shop_staff' | 'customer'

export interface User {
  uuid: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  phone_number: string
  language: string
  role: UserRole
  is_active: boolean
  is_verified: boolean
  created_at: string
}

/**
 * dj-rest-auth varies the JWT response key across versions.
 * Some return `access`/`refresh`; some return `access_token`/`refresh_token`.
 * We accept both at the service layer and normalize to {access, refresh}.
 */
export interface AuthTokens {
  access: string
  refresh: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  email: string
  password: string
  first_name?: string
  last_name?: string
}

export interface SetPasswordPayload {
  email: string
  token: string
  password: string
}

export interface PasswordResetRequestPayload {
  email: string
}

export interface PasswordResetConfirmPayload {
  uid: string
  token: string
  new_password1: string
  new_password2: string
}
