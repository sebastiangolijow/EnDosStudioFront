import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AsyncStatus } from '@/types/api'
import type { Order } from '@/types/order'

export const useOrderStore = defineStore('order', () => {
  /** The order the customer is currently editing or checking out. */
  const currentOrder = ref<Order | null>(null)

  /** Orders the customer has placed; populated on dashboard. */
  const orderHistory = ref<Order[]>([])

  /** Local copy of the original image File before upload (NOT in `currentOrder.files`
   *  until uploaded). The OrderFile arrives back as a URL once POST'd to the backend. */
  const localOriginalFile = ref<File | null>(null)
  const localOriginalUrl = ref<string | null>(null)

  /** The Stripe checkout response, kept around so the checkout view can reuse
   *  the client_secret if the user hits "back" and returns. */
  const checkout = ref<{ client_secret: string; payment_intent_id: string } | null>(null)

  const status = ref<AsyncStatus>('idle')
  const error = ref<string | null>(null)

  function setCurrent(order: Order | null) {
    currentOrder.value = order
  }

  function setOriginalFile(file: File, objectUrl: string) {
    localOriginalFile.value = file
    localOriginalUrl.value = objectUrl
  }

  function setHistory(orders: Order[]) {
    orderHistory.value = orders
  }

  function setCheckout(payload: { client_secret: string; payment_intent_id: string }) {
    checkout.value = payload
  }

  function reset() {
    currentOrder.value = null
    if (localOriginalUrl.value) URL.revokeObjectURL(localOriginalUrl.value)
    localOriginalFile.value = null
    localOriginalUrl.value = null
    checkout.value = null
    status.value = 'idle'
    error.value = null
  }

  return {
    currentOrder,
    orderHistory,
    localOriginalFile,
    localOriginalUrl,
    checkout,
    status,
    error,
    setCurrent,
    setOriginalFile,
    setHistory,
    setCheckout,
    reset,
  }
})
