/**
 * Single entry point for "start a new sticker order".
 *
 * Branches on auth state:
 *   - Logged-in:   create a backend draft and land at /editor/{uuid}
 *                  (full feature set: persistence, smart-cut, place).
 *   - Anonymous:   skip the draft creation and land at /editor (no
 *                  uuid). The editor renders in anonymous mode —
 *                  customer plays with auto-crop, geometry shapes,
 *                  materials; smart-cut is allowed but rate-limited
 *                  server-side. Auth wall fires when they click
 *                  "Material y tamaño". They lose editor state on
 *                  register (design tradeoff: simpler than IDB stash).
 *
 * Failure path on the authenticated branch: toast error and stay on
 * the current page. Anonymous never fails — it's a client-only push.
 */
import { useRouter } from 'vue-router'
import { ordersService } from '@/services/orders.service'
import { useAuthStore } from '@/stores/auth.store'
import { useOrderStore } from '@/stores/order.store'
import { useToast } from './useToast'

export function useNewSticker() {
  const router = useRouter()
  const toast = useToast()
  const orderStore = useOrderStore()
  const auth = useAuthStore()

  /** Returns true if the navigation was initiated, false if it failed
   *  (a toast was already shown). Callers can use the return value for
   *  fallback navigation. */
  async function startNewSticker(): Promise<boolean> {
    if (!auth.isAuthenticated) {
      // Anonymous mode — push straight to the editor with no draft.
      // EditorView detects the missing :uuid and renders accordingly.
      router.push({ name: 'editor-anonymous' })
      return true
    }
    try {
      const draft = await ordersService.createDraft()
      orderStore.setCurrent(draft)
      router.push({ name: 'editor', params: { uuid: draft.uuid } })
      return true
    } catch (e) {
      const detail =
        (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
        'No pudimos crear un nuevo pedido. Intentá de nuevo.'
      toast.error(detail)
      return false
    }
  }

  return { startNewSticker }
}
