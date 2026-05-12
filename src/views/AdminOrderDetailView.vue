<script setup lang="ts">
/**
 * Admin order detail — single-order command screen.
 *
 * Layout (top → bottom):
 *   - Top bar: back link, order short-ID, status badge, status timeline.
 *   - Two-column body:
 *     LEFT (wide): the design — original image + die_cut_mask preview +
 *       sticker spec (material/shape/size/qty/add-ons/relief note) OR
 *       catalog product summary.
 *     RIGHT (narrow, sticky): customer contact, shipping address,
 *       total, lifecycle timeline timestamps, status transition controls.
 *
 * Status transitions surfaced as full-width buttons keyed to current
 * status: Marcar como pagado (placed→paid), Iniciar producción
 * (paid→in_production), Marcar enviado (in_production→shipped),
 * Cancelar (draft/placed only).
 *
 * Files (sticker orders):
 *   - original         — customer's uploaded design
 *   - die_cut_mask     — the cut polygon from the editor
 *   - cut_path         — server-generated SVG (vinyl plotter file).
 *                        Direct download link.
 *   - preview_composite — future (post-C2): the customer's final
 *                        editor view with all material FX applied.
 *                        Shows when present; placeholder when not.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DashboardShell from '@/components/layout/DashboardShell.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { ordersService } from '@/services/orders.service'
import { useToast } from '@/composables/useToast'
import { type Order, MATERIAL_LABELS, SHAPE_LABELS } from '@/types/order'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const orderUuid = computed(() => route.params.uuid as string)
const order = ref<Order | null>(null)
const isLoading = ref<boolean>(true)
const isTransitioning = ref<boolean>(false)

async function loadOrder() {
  isLoading.value = true
  try {
    order.value = await ordersService.retrieve(orderUuid.value)
  } catch {
    toast.error('No pudimos cargar el pedido.')
    router.push({ name: 'admin-orders' })
  } finally {
    isLoading.value = false
  }
}

onMounted(loadOrder)

// === Computed display ===

const originalFile = computed(() =>
  order.value?.files.find((f) => f.kind === 'original') ?? null,
)
const dieCutMaskFile = computed(() =>
  order.value?.files.find((f) => f.kind === 'die_cut_mask') ?? null,
)
const previewCompositeFile = computed(() =>
  order.value?.files.find((f) => f.kind === 'preview_composite') ?? null,
)
// cut_path is the server-generated SVG (added in transition_to_paid).
// Not in the frontend's OrderFileKind union because we never upload
// it — read-only. String compare so TS doesn't complain.
const cutPathFile = computed(() =>
  order.value?.files.find((f) => (f.kind as string) === 'cut_path') ?? null,
)

const sizeLabel = computed(() => {
  if (!order.value) return '—'
  if (!order.value.width_mm || !order.value.height_mm) return '—'
  return `${order.value.width_mm / 10}×${order.value.height_mm / 10} cm`
})

const materialLabel = computed(() =>
  order.value?.material ? MATERIAL_LABELS[order.value.material] : '—',
)

const shapeLabel = computed(() =>
  order.value?.shape ? SHAPE_LABELS[order.value.shape] : '—',
)

const addons = computed(() => {
  if (!order.value) return [] as string[]
  const list: string[] = []
  if (order.value.with_relief) list.push('Relieve')
  if (order.value.with_tinta_blanca) list.push('Tinta blanca')
  if (order.value.with_barniz_brillo) list.push('Barniz brillo')
  if (order.value.with_barniz_opaco) list.push('Barniz opaco')
  return list
})

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const shippingAddress = computed(() => {
  if (!order.value) return null
  const o = order.value
  const lines = [
    o.recipient_name,
    o.street_line_1,
    o.street_line_2,
    [o.postal_code, o.city].filter(Boolean).join(' '),
    o.country,
  ].filter(Boolean)
  return lines.length > 0 ? lines : null
})

// === Status transitions ===
//
// Same pattern as the list view's quickActionFor — but here the
// buttons live in the right-rail action panel and we don't refresh a
// count card. After a successful transition we re-fetch the full
// order so files (cut_path SVG appears after mark-paid) and
// timestamps update.

async function transition(
  action: 'markPaid' | 'startProduction' | 'ship' | 'cancel',
) {
  if (!order.value || isTransitioning.value) return
  isTransitioning.value = true
  try {
    let updated: Order
    if (action === 'markPaid') updated = await ordersService.markPaid(order.value.uuid)
    else if (action === 'startProduction') updated = await ordersService.startProduction(order.value.uuid)
    else if (action === 'ship') updated = await ordersService.ship(order.value.uuid)
    else updated = await ordersService.cancel(order.value.uuid)
    order.value = updated
    const messages: Record<typeof action, string> = {
      markPaid: 'Pedido marcado como pagado.',
      startProduction: 'Pedido en producción.',
      ship: 'Pedido marcado como enviado.',
      cancel: 'Pedido cancelado.',
    }
    toast.success(messages[action])
    // Re-fetch in case server-side side effects (cut_path file generation
    // on mark-paid) didn't make it into the response.
    if (action === 'markPaid') await loadOrder()
  } catch (e) {
    const detail =
      (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    toast.error(detail ?? 'No pudimos completar la acción.')
  } finally {
    isTransitioning.value = false
  }
}

function shortId(uuid: string): string {
  return `#${uuid.slice(0, 8)}`
}

const canMarkPaid = computed(() => order.value?.status === 'placed')
const canStartProduction = computed(() => order.value?.status === 'paid')
const canShip = computed(() => order.value?.status === 'in_production')
const canCancel = computed(
  () => order.value?.status === 'draft' || order.value?.status === 'placed',
)
</script>

<template>
  <DashboardShell>
    <div
      v-if="isLoading"
      class="py-12 text-center text-text-muted"
    >
      Cargando pedido…
    </div>

    <div v-else-if="order">
      <!-- Top bar -->
      <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <AppButton
            variant="ghost"
            size="sm"
            @click="router.push({ name: 'admin-orders' })"
          >
            ← Volver a pedidos
          </AppButton>
          <h1 class="font-mono text-h3 font-bold text-text">
            Pedido {{ shortId(order.uuid) }}
          </h1>
          <StatusBadge :status="order.status" />
        </div>
        <p class="text-sm text-text-muted">
          Creado {{ formatDateTime(order.created_at) }}
        </p>
      </header>

      <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
        <!-- LEFT: design + spec -->
        <div class="flex flex-col gap-6">
          <!-- Design preview block -->
          <section
            v-if="order.kind === 'sticker'"
            class="rounded-lg border border-border bg-surface-1 p-5"
          >
            <h2 class="mb-4 text-h3 font-semibold text-text">
              Diseño
            </h2>
            <div class="grid gap-4 sm:grid-cols-2">
              <!-- Original upload -->
              <div>
                <p class="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                  Imagen original del cliente
                </p>
                <div
                  class="aspect-square overflow-hidden rounded-md border border-border bg-surface-2"
                  data-testid="admin-order-original-image"
                >
                  <img
                    v-if="originalFile?.file"
                    :src="originalFile.file"
                    :alt="`Diseño original del pedido ${shortId(order.uuid)}`"
                    class="size-full object-contain"
                  >
                  <div
                    v-else
                    class="flex h-full items-center justify-center text-sm text-text-muted"
                  >
                    Sin imagen original
                  </div>
                </div>
              </div>
              <!-- Preview composite (post-C2 feature). Falls back to
                   die_cut_mask thumbnail when not yet uploaded. -->
              <div>
                <p class="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                  {{ previewCompositeFile ? 'Vista del cliente' : 'Línea de corte' }}
                </p>
                <div
                  class="aspect-square overflow-hidden rounded-md border border-border bg-surface-2"
                  data-testid="admin-order-preview-image"
                >
                  <img
                    v-if="previewCompositeFile?.file"
                    :src="previewCompositeFile.file"
                    :alt="`Vista final del cliente para ${shortId(order.uuid)}`"
                    class="size-full object-contain"
                  >
                  <img
                    v-else-if="dieCutMaskFile?.file"
                    :src="dieCutMaskFile.file"
                    :alt="`Polígono de corte para ${shortId(order.uuid)}`"
                    class="size-full object-contain"
                  >
                  <div
                    v-else
                    class="flex h-full items-center justify-center text-sm text-text-muted"
                  >
                    Sin previsualización
                  </div>
                </div>
              </div>
            </div>
            <!-- Production-ready cut SVG download -->
            <div
              v-if="cutPathFile?.file"
              class="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-4 py-3"
            >
              <p class="text-sm text-text-muted">
                Archivo de corte (SVG) listo para la plotter.
              </p>
              <a
                :href="cutPathFile.file"
                target="_blank"
                rel="noopener"
                class="rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
                data-testid="admin-order-cut-path-download"
              >
                Descargar SVG
              </a>
            </div>
          </section>

          <!-- Sticker spec -->
          <section
            v-if="order.kind === 'sticker'"
            class="rounded-lg border border-border bg-surface-1 p-5"
          >
            <h2 class="mb-4 text-h3 font-semibold text-text">
              Especificación
            </h2>
            <dl class="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt class="text-xs uppercase tracking-wide text-text-muted">Material</dt>
                <dd class="text-text">{{ materialLabel }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase tracking-wide text-text-muted">Forma de corte</dt>
                <dd class="text-text">{{ shapeLabel }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase tracking-wide text-text-muted">Tamaño</dt>
                <dd class="text-text">{{ sizeLabel }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase tracking-wide text-text-muted">Cantidad</dt>
                <dd class="text-text">{{ order.quantity }} unidades</dd>
              </div>
              <div class="sm:col-span-2">
                <dt class="text-xs uppercase tracking-wide text-text-muted">Add-ons</dt>
                <dd class="text-text">
                  <span v-if="addons.length === 0">Ninguno</span>
                  <span v-else>{{ addons.join(' · ') }}</span>
                </dd>
              </div>
              <div
                v-if="order.with_relief && order.relief_note"
                class="sm:col-span-2"
              >
                <dt class="text-xs uppercase tracking-wide text-text-muted">Nota de relieve</dt>
                <dd class="whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-text">
                  {{ order.relief_note }}
                </dd>
              </div>
            </dl>
          </section>

          <!-- Catalog product summary (kind=catalog) -->
          <section
            v-else
            class="rounded-lg border border-border bg-surface-1 p-5"
          >
            <h2 class="mb-4 text-h3 font-semibold text-text">
              Producto del catálogo
            </h2>
            <div class="flex items-center gap-4">
              <div class="size-24 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2">
                <img
                  v-if="order.product_detail?.image"
                  :src="order.product_detail.image"
                  :alt="order.product_detail.name"
                  class="size-full object-cover"
                >
              </div>
              <div>
                <p class="font-semibold text-text">
                  {{ order.product_detail?.name ?? '—' }}
                </p>
                <p class="mt-1 text-sm text-text-muted">
                  {{ order.product_quantity }} unidad{{ order.product_quantity === 1 ? '' : 'es' }}
                </p>
                <p class="mt-1 text-sm text-text-muted">
                  €{{ order.product_detail?.price_eur ?? '0.00' }} c/u
                </p>
              </div>
            </div>
          </section>
        </div>

        <!-- RIGHT: customer + transitions (sticky) -->
        <aside class="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <!-- Customer -->
          <section class="rounded-lg border border-border bg-surface-1 p-5">
            <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Cliente
            </h3>
            <p
              class="font-medium text-text"
              data-testid="admin-order-customer-name"
            >
              {{ order.customer_name || '—' }}
            </p>
            <a
              v-if="order.customer_email"
              :href="`mailto:${order.customer_email}`"
              class="mt-1 block break-all text-sm text-primary hover:underline"
              data-testid="admin-order-customer-email"
            >
              {{ order.customer_email }}
            </a>
          </section>

          <!-- Shipping -->
          <section
            v-if="shippingAddress"
            class="rounded-lg border border-border bg-surface-1 p-5"
          >
            <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Dirección de envío
            </h3>
            <address
              class="not-italic text-sm leading-relaxed text-text"
              data-testid="admin-order-shipping"
            >
              <p
                v-for="(line, i) in shippingAddress"
                :key="i"
              >
                {{ line }}
              </p>
            </address>
          </section>

          <!-- Total -->
          <section class="rounded-lg border border-border bg-surface-1 p-5">
            <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Total
            </h3>
            <p class="text-2xl font-bold text-text">
              €{{ order.total_eur || '0.00' }}
              <span class="text-base font-normal text-text-muted">{{ order.currency || 'EUR' }}</span>
            </p>
            <p
              v-if="order.stripe_payment_intent_id"
              class="mt-2 font-mono text-xs text-text-muted"
            >
              Stripe: {{ order.stripe_payment_intent_id }}
            </p>
          </section>

          <!-- Lifecycle timeline -->
          <section class="rounded-lg border border-border bg-surface-1 p-5">
            <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Línea de tiempo
            </h3>
            <ul class="space-y-2 text-sm">
              <li class="flex items-center justify-between gap-2">
                <span class="text-text-muted">Creado</span>
                <span class="text-text">{{ formatDateTime(order.created_at) }}</span>
              </li>
              <li class="flex items-center justify-between gap-2">
                <span class="text-text-muted">Confirmado</span>
                <span class="text-text">{{ formatDateTime(order.placed_at) }}</span>
              </li>
              <li class="flex items-center justify-between gap-2">
                <span class="text-text-muted">Pagado</span>
                <span class="text-text">{{ formatDateTime(order.paid_at) }}</span>
              </li>
              <li class="flex items-center justify-between gap-2">
                <span class="text-text-muted">Enviado</span>
                <span class="text-text">{{ formatDateTime(order.shipped_at) }}</span>
              </li>
              <li class="flex items-center justify-between gap-2">
                <span class="text-text-muted">Entregado</span>
                <span class="text-text">{{ formatDateTime(order.delivered_at) }}</span>
              </li>
              <li
                v-if="order.cancelled_at"
                class="flex items-center justify-between gap-2"
              >
                <span class="text-text-muted">Cancelado</span>
                <span class="text-text">{{ formatDateTime(order.cancelled_at) }}</span>
              </li>
            </ul>
          </section>

          <!-- Status transitions (only when applicable) -->
          <section
            v-if="canMarkPaid || canStartProduction || canShip || canCancel"
            class="rounded-lg border border-border bg-surface-1 p-5"
          >
            <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Acciones
            </h3>
            <div class="flex flex-col gap-2">
              <AppButton
                v-if="canMarkPaid"
                :loading="isTransitioning"
                data-testid="admin-order-mark-paid"
                @click="transition('markPaid')"
              >
                Marcar como pagado
              </AppButton>
              <AppButton
                v-if="canStartProduction"
                :loading="isTransitioning"
                data-testid="admin-order-start-production"
                @click="transition('startProduction')"
              >
                Iniciar producción
              </AppButton>
              <AppButton
                v-if="canShip"
                :loading="isTransitioning"
                data-testid="admin-order-ship"
                @click="transition('ship')"
              >
                Marcar enviado
              </AppButton>
              <AppButton
                v-if="canCancel"
                variant="ghost"
                :loading="isTransitioning"
                data-testid="admin-order-cancel"
                @click="transition('cancel')"
              >
                Cancelar pedido
              </AppButton>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </DashboardShell>
</template>
