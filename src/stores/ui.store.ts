import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  message: string
  variant: ToastVariant
  /** ms; null = sticky until dismissed. */
  ttl: number | null
}

export const useUIStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const sidebarCollapsed = ref(false)
  const currentStep = ref(1) // 1..4 for the upload→checkout flow

  function pushToast(toast: Omit<Toast, 'id'>) {
    const id = Math.random().toString(36).slice(2)
    toasts.value.push({ ...toast, id })
    if (toast.ttl !== null) {
      setTimeout(() => dismissToast(id), toast.ttl)
    }
    return id
  }

  function dismissToast(id: string) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function setStep(step: number) {
    currentStep.value = step
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return {
    toasts,
    sidebarCollapsed,
    currentStep,
    pushToast,
    dismissToast,
    setStep,
    toggleSidebar,
  }
})
