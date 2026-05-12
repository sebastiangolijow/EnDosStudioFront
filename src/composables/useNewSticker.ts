/**
 * Single entry point for "start a new sticker order".
 *
 * Replaces the old flow where customers landed on UploadView first.
 * Now: click "Subir mi diseño" (home), "+ Nuevo pedido" (dashboard),
 * or "+ Crear otro pedido" (confirmation) → an empty draft order is
 * created on the backend and the customer lands directly in the
 * editor where they drop the image (the editor renders the dropzone
 * empty-state until there's an `original` file uploaded).
 *
 * Failure path: toast error and stay on the current page. The
 * customer can retry without state corruption (no draft was created
 * if the POST failed).
 */
import { useRouter } from 'vue-router'
import { ordersService } from '@/services/orders.service'
import { useOrderStore } from '@/stores/order.store'
import { useToast } from './useToast'

export function useNewSticker() {
  const router = useRouter()
  const toast = useToast()
  const orderStore = useOrderStore()

  /** Returns true if the navigation was initiated (draft created),
   *  false if it failed (a toast was already shown). Callers can use
   *  the return value for fallback navigation. */
  async function startNewSticker(): Promise<boolean> {
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
