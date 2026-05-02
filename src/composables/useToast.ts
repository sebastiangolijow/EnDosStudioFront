import { useUIStore, type ToastVariant } from '@/stores/ui.store'

export function useToast() {
  const ui = useUIStore()

  function show(message: string, variant: ToastVariant = 'info', ttl: number | null = 4000) {
    return ui.pushToast({ message, variant, ttl })
  }

  return {
    show,
    success: (msg: string) => show(msg, 'success'),
    error: (msg: string) => show(msg, 'error', 6000),
    warning: (msg: string) => show(msg, 'warning'),
    info: (msg: string) => show(msg, 'info'),
  }
}
