<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { ordersService } from '@/services/orders.service'
import { useToast } from '@/composables/useToast'
import { useNewSticker } from '@/composables/useNewSticker'
import { type Order, MATERIAL_LABELS } from '@/types/order'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { startNewSticker } = useNewSticker()

const orderUuid = computed(() => route.params.uuid as string | undefined)
const order = ref<Order | null>(null)
const isLoading = ref<boolean>(true)

async function loadOrder() {
  if (!orderUuid.value) {
    router.push('/dashboard')
    return
  }
  try {
    order.value = await ordersService.retrieve(orderUuid.value)
  } catch {
    toast.error('No pudimos cargar tu pedido. Volvé al dashboard.')
    router.push('/dashboard')
  } finally {
    isLoading.value = false
  }
}

// Poll order status while we wait for the Stripe webhook to flip
// 'placed' -> 'paid'. Stripe webhooks fire async, typically within
// 1-3 seconds of confirmPayment success. We poll every 2s for up to
// 30s, then give up (the order is still safely 'placed' and will
// transition when the webhook eventually arrives — UI just won't
// auto-update without a manual refresh).
const isPollingPaid = ref<boolean>(false)
let pollTimer: number | null = null

function shouldPollForPaid(o: Order | null): boolean {
  return !!o && o.status === 'placed' && o.kind !== 'catalog' // catalog skips Stripe
}

async function pollUntilPaid() {
  if (!orderUuid.value) return
  isPollingPaid.value = true
  const startedAt = Date.now()
  const MAX_MS = 30_000
  const INTERVAL_MS = 2_000
  while (Date.now() - startedAt < MAX_MS) {
    try {
      const fresh = await ordersService.retrieve(orderUuid.value)
      order.value = fresh
      if (fresh.status !== 'placed') {
        isPollingPaid.value = false
        return
      }
    } catch { /* transient — keep polling */ }
    await new Promise<void>((resolve) => {
      pollTimer = window.setTimeout(resolve, INTERVAL_MS)
    })
  }
  isPollingPaid.value = false
}

onBeforeUnmount(() => {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
})

const shortId = computed(() => (order.value ? `#${order.value.uuid.slice(0, 8)}` : ''))

const isCatalogOrder = computed<boolean>(() => order.value?.kind === 'catalog')

const isReservedOrder = computed<boolean>(() => order.value?.status === 'reserved')

const pickupAtLabel = computed<string>(() => {
  if (!order.value?.pickup_at) return ''
  const d = new Date(order.value.pickup_at)
  return d.toLocaleString('es-ES', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const sizeLabel = computed(() => {
  if (!order.value || !order.value.width_mm || !order.value.height_mm) return '—'
  return `${order.value.width_mm / 10}×${order.value.height_mm / 10} cm`
})

const materialLabel = computed(() =>
  order.value?.material ? MATERIAL_LABELS[order.value.material] : '—',
)

const thumbnailUrl = computed<string | null>(() => {
  if (!order.value) return null
  if (isCatalogOrder.value) {
    return order.value.product_detail?.image ?? null
  }
  // Prefer the editor's composite snapshot over the raw original upload —
  // same reasoning as OrderConfigView / CheckoutView. The customer sees
  // their final designed sticker (with FX) instead of the bare PNG they
  // uploaded.
  const composite = order.value.files.find((f) => f.kind === 'preview_composite')
  if (composite) return composite.file
  const original = order.value.files.find((f) => f.kind === 'original')
  return original?.file ?? null
})

onMounted(async () => {
  await loadOrder()
  if (shouldPollForPaid(order.value)) {
    pollUntilPaid()
  }
})
</script>

<template>
  <section class="mx-auto max-w-2xl px-6 py-16 text-center">
    <div
      v-if="isLoading"
      class="rounded-lg border border-border bg-surface-2 p-12 text-text-muted"
    >
      Cargando...
    </div>

    <div v-else-if="order">
      <!-- Hero — different copy for reserved (in-store pickup) vs.
           paid-online orders. The Stripe-paid flow has the "we'll
           email you when production starts" promise; reservations
           hinge on the customer showing up in person, so we make
           the pickup datetime the headline. -->
      <div class="text-6xl">
        {{ isReservedOrder ? '🛒' : '🔥' }}
      </div>
      <h1 class="mt-4 text-h1 font-bold text-text">
        {{ isReservedOrder ? 'Pedido reservado' : 'Pedido recibido' }}
      </h1>
      <p
        v-if="isReservedOrder"
        class="mt-2 text-text-muted"
      >
        Reserva <strong class="text-text">{{ shortId }}</strong>. Pasá por
        la tienda en la fecha elegida y lo pagás en efectivo al retirar.
      </p>
      <p
        v-else
        class="mt-2 text-text-muted"
      >
        Pedido <strong class="text-text">{{ shortId }}</strong>. Te avisaremos por email cuando entre en producción.
      </p>

      <!-- Status -->
      <div class="mt-6 inline-flex items-center gap-2">
        <span class="text-sm text-text-muted">Estado actual:</span>
        <StatusBadge :status="order.status" />
      </div>

      <!-- Stripe-paid orders briefly sit at 'placed' until the webhook fires.
           We poll for ~30s after landing here; show a quiet hint so the
           customer doesn't think the page is broken. -->
      <p
        v-if="isPollingPaid"
        class="mt-3 text-xs text-text-muted"
        data-testid="confirming-payment-hint"
      >
        Confirmando tu pago con Stripe…
      </p>

      <!-- Pickup info block — only renders for reserved orders. Mirrors
           the structure of the shipping email so the customer has the
           same details to act on whichever channel they read. -->
      <AppCard
        v-if="isReservedOrder && pickupAtLabel"
        class="mx-auto mt-6 max-w-md text-left"
        data-testid="confirmation-pickup-block"
      >
        <h2 class="text-h3 font-semibold text-text">
          Retiro en tienda
        </h2>
        <dl class="mt-3 flex flex-col gap-2 text-sm">
          <div class="flex items-baseline gap-2">
            <dt class="text-text-muted">
              📅 Fecha:
            </dt>
            <dd class="font-medium text-text">
              {{ pickupAtLabel }}
            </dd>
          </div>
          <div class="flex items-baseline gap-2">
            <dt class="text-text-muted">
              💶 Pago:
            </dt>
            <dd class="font-medium text-text">
              En efectivo, al retirar
            </dd>
          </div>
        </dl>
      </AppCard>

      <!-- Order summary card (kind-aware) -->
      <AppCard
        class="mx-auto mt-8 max-w-md text-left"
        :data-testid="isCatalogOrder ? 'confirmation-catalog-summary' : 'confirmation-sticker-summary'"
      >
        <div class="flex items-center gap-4">
          <div class="size-20 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2">
            <img
              v-if="thumbnailUrl"
              :src="thumbnailUrl"
              :alt="`Pedido ${shortId}`"
              class="size-full object-cover"
            >
            <div
              v-else
              class="size-full bg-holographic opacity-30"
              aria-hidden="true"
            />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold text-text">
              {{ isCatalogOrder ? (order.product_detail?.name ?? '—') : materialLabel }}
            </p>
            <p class="text-sm text-text-muted">
              <template v-if="isCatalogOrder">
                {{ order.product_quantity }} unidad(es)
              </template>
              <template v-else>
                {{ sizeLabel }} · {{ order.quantity }} unidades
              </template>
            </p>
            <p class="mt-1 font-bold text-text">
              €{{ order.total_eur }}
            </p>
          </div>
        </div>
      </AppCard>

      <!-- Actions -->
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <AppButton
          variant="secondary"
          @click="router.push('/dashboard')"
        >
          Ir al dashboard
        </AppButton>
        <AppButton
          v-if="isCatalogOrder"
          @click="router.push('/catalogo')"
        >
          Seguir comprando
        </AppButton>
        <AppButton
          v-else
          @click="startNewSticker"
        >
          Crear otro pedido
        </AppButton>
      </div>

      <p class="mt-6 text-xs text-text-muted">
        ¿Algo no encaja?
        <a
          href="mailto:soporte@stickerapp.local"
          class="text-primary hover:underline"
        >Contactanos</a>.
      </p>
    </div>
  </section>
</template>
