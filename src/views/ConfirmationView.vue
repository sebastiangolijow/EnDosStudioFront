<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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

const shortId = computed(() => (order.value ? `#${order.value.uuid.slice(0, 8)}` : ''))

const isCatalogOrder = computed<boolean>(() => order.value?.kind === 'catalog')

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

onMounted(loadOrder)
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
      <!-- Hero confirmation -->
      <div class="text-6xl">
        🔥
      </div>
      <h1 class="mt-4 text-h1 font-bold text-text">
        Pedido recibido
      </h1>
      <p class="mt-2 text-text-muted">
        Pedido <strong class="text-text">{{ shortId }}</strong>. Te avisaremos por email cuando entre en producción.
      </p>

      <!-- Status -->
      <div class="mt-6 inline-flex items-center gap-2">
        <span class="text-sm text-text-muted">Estado actual:</span>
        <StatusBadge :status="order.status" />
      </div>

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
