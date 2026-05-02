/**
 * Cross-cutting API types.
 *
 * AsyncStatus is the contract that every async action exposes —
 * see CLAUDE.md "Async states are explicit" for why this matters.
 */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ApiError {
  /** HTTP status code (0 if the request never reached the server). */
  status: number
  /** Human-readable error from backend or a normalized fallback. */
  message: string
  /** Field-level validation errors keyed by field name, when DRF returns them. */
  fieldErrors?: Record<string, string[]>
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
