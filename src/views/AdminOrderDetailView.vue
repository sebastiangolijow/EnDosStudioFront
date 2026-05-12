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
import AppInput from '@/components/ui/AppInput.vue'
import AppModal from '@/components/ui/AppModal.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { ordersService } from '@/services/orders.service'
import { useToast } from '@/composables/useToast'
import {
  type Order,
  type OrderStatus,
  MATERIAL_LABELS,
  SHAPE_LABELS,
  STATUS_LABELS,
} from '@/types/order'

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
    syncSelectedStatus()
  } catch {
    toast.error('No pudimos cargar el pedido.')
    router.push({ name: 'admin-orders' })
  } finally {
    isLoading.value = false
  }
}

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

// === Status override (admin-set-status) ===
//
// The shop owner picks a status from the dropdown and clicks
// "Aplicar". Bypasses the usual transition guards — used for manual
// corrections (re-opening a cancelled order, retroactively marking
// delivered, etc.). When the target is 'shipped' we open a popup
// first to capture carrier / tracking / ETA; the backend sends the
// customer a notification email at that point.

const STATUSES: OrderStatus[] = [
  'draft',
  'placed',
  'paid',
  'in_production',
  'shipped',
  'delivered',
  'cancelled',
]

// `selectedStatus` is the dropdown's working value (may differ from
// `order.status` while the admin is choosing). Synced from the loaded
// order so the dropdown defaults to the current status.
const selectedStatus = ref<OrderStatus>('draft')

// Shipped popup state.
const shippedModalOpen = ref<boolean>(false)
const shippingCarrier = ref<string>('')
const shippingTrackingCode = ref<string>('')
const shippingEtaDate = ref<string>('') // ISO date (YYYY-MM-DD) from <input type="date">
const knownCarriers = ref<string[]>([])

async function loadCarriers() {
  try {
    knownCarriers.value = await ordersService.listShippingCarriers()
  } catch {
    // Non-blocking — the input still accepts free text without suggestions.
  }
}

async function applyStatusChange() {
  if (!order.value || isTransitioning.value) return
  if (selectedStatus.value === order.value.status) {
    toast.info('El pedido ya está en ese estado.')
    return
  }
  // Shipped is the one transition that needs extra metadata. Open the
  // popup; the actual server call happens from submitShippedPopup.
  if (selectedStatus.value === 'shipped') {
    // Pre-fill from any prior values so the admin can correct a typo
    // without re-typing the carrier.
    shippingCarrier.value = order.value.shipping_carrier ?? ''
    shippingTrackingCode.value = order.value.shipping_tracking_code ?? ''
    shippingEtaDate.value = order.value.shipping_eta_date ?? ''
    shippedModalOpen.value = true
    return
  }
  await postStatusChange({ status: selectedStatus.value })
}

async function postStatusChange(payload: {
  status: OrderStatus
  shipping_carrier?: string
  shipping_tracking_code?: string
  shipping_eta_date?: string | null
}) {
  if (!order.value) return
  isTransitioning.value = true
  try {
    const updated = await ordersService.adminSetStatus(order.value.uuid, payload)
    order.value = updated
    selectedStatus.value = updated.status
    if (payload.status === 'shipped' && payload.shipping_tracking_code) {
      toast.success('Pedido marcado enviado. Email enviado al cliente.')
    } else {
      toast.success('Estado actualizado.')
    }
    // Re-fetch in case server-side side effects didn't make it into
    // the response (cut_path SVG appears on the paid transition).
    if (payload.status === 'paid') await loadOrder()
  } catch (e) {
    const detail
      = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    toast.error(detail ?? 'No pudimos actualizar el estado.')
  } finally {
    isTransitioning.value = false
  }
}

async function submitShippedPopup() {
  if (!shippingCarrier.value.trim() || !shippingTrackingCode.value.trim()) {
    toast.warning('Completá transportista y código de seguimiento.')
    return
  }
  await postStatusChange({
    status: 'shipped',
    shipping_carrier: shippingCarrier.value.trim(),
    shipping_tracking_code: shippingTrackingCode.value.trim(),
    shipping_eta_date: shippingEtaDate.value || null,
  })
  shippedModalOpen.value = false
}

function cancelShippedPopup() {
  shippedModalOpen.value = false
  // Restore the dropdown to the actual status so the admin doesn't see
  // a misleading "shipped" pending state after dismissing the popup.
  if (order.value) selectedStatus.value = order.value.status
}

function shortId(uuid: string): string {
  return `#${uuid.slice(0, 8)}`
}

// Re-sync selectedStatus whenever the order loads/changes — keeps the
// dropdown in lockstep with the server's view.
function syncSelectedStatus() {
  if (order.value) selectedStatus.value = order.value.status
}

onMounted(() => {
  loadOrder()
  loadCarriers()
})
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
                <!-- Download CTA — direct link to the backend's media URL.
                     `download` attribute hints the browser to save instead
                     of navigate; the filename ultimately depends on the
                     server's Content-Disposition header. -->
                <a
                  v-if="originalFile?.file"
                  :href="originalFile.file"
                  :download="`pedido-${shortId(order.uuid).replace('#', '')}-original`"
                  target="_blank"
                  rel="noopener"
                  class="mt-2 block w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-center text-xs font-semibold text-text transition hover:border-primary hover:text-primary"
                  data-testid="admin-order-download-original"
                >
                  ⬇ Descargar original
                </a>
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
                <!-- Download CTA prefers the composite (what the customer
                     designed); falls back to the raw die_cut_mask. -->
                <a
                  v-if="previewCompositeFile?.file || dieCutMaskFile?.file"
                  :href="(previewCompositeFile?.file ?? dieCutMaskFile?.file) || '#'"
                  :download="`pedido-${shortId(order.uuid).replace('#', '')}-${previewCompositeFile ? 'composicion' : 'corte'}`"
                  target="_blank"
                  rel="noopener"
                  class="mt-2 block w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-center text-xs font-semibold text-text transition hover:border-primary hover:text-primary"
                  data-testid="admin-order-download-preview"
                >
                  ⬇ Descargar {{ previewCompositeFile ? 'composición' : 'línea de corte' }}
                </a>
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
            <!-- Per-shipment contact — phone is required at place_order,
                 email is optional. Both can differ from the customer's
                 account info (gift orders, alt notification address).
                 Phone is a clickable tel: link so the shop owner can
                 ring the customer about pickup. -->
            <div
              v-if="order.shipping_phone || order.shipping_email"
              class="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm"
            >
              <a
                v-if="order.shipping_phone"
                :href="`tel:${order.shipping_phone}`"
                class="text-primary hover:underline"
                data-testid="admin-order-shipping-phone"
              >
                📞 {{ order.shipping_phone }}
              </a>
              <a
                v-if="order.shipping_email"
                :href="`mailto:${order.shipping_email}`"
                class="break-all text-primary hover:underline"
                data-testid="admin-order-shipping-email"
              >
                ✉️ {{ order.shipping_email }}
              </a>
            </div>
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

          <!-- Status override — admin can force any status. Picking
               'shipped' opens a popup to collect carrier + tracking +
               ETA; submitting that triggers the customer email. -->
          <section class="rounded-lg border border-border bg-surface-1 p-5">
            <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Acciones
            </h3>
            <div class="flex flex-col gap-3">
              <label
                for="admin-order-status-select"
                class="text-xs text-text-muted"
              >
                Cambiar estado
              </label>
              <select
                id="admin-order-status-select"
                v-model="selectedStatus"
                data-testid="admin-order-status-select"
                class="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-text focus-visible:border-primary focus-visible:outline-none"
              >
                <option
                  v-for="s in STATUSES"
                  :key="s"
                  :value="s"
                >
                  {{ STATUS_LABELS[s] }}
                </option>
              </select>
              <AppButton
                :loading="isTransitioning"
                :disabled="selectedStatus === order.status"
                data-testid="admin-order-apply-status"
                @click="applyStatusChange"
              >
                Aplicar
              </AppButton>
              <!-- Helper text spells out what 'shipped' triggers so the
                   admin isn't surprised by the email going out. -->
              <p
                v-if="selectedStatus === 'shipped' && order.status !== 'shipped'"
                class="text-xs text-text-muted"
              >
                Al confirmar te vamos a pedir transportista, código de seguimiento
                y fecha estimada. El cliente recibe un email automático.
              </p>
              <!-- Show current shipping info when the order is already
                   shipped — lets the admin verify what was sent. -->
              <div
                v-if="order.shipping_tracking_code"
                class="mt-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-text"
              >
                <p class="mb-1 text-text-muted">
                  Envío actual:
                </p>
                <p>📦 {{ order.shipping_carrier || '—' }}</p>
                <p class="font-mono">
                  🔖 {{ order.shipping_tracking_code }}
                </p>
                <p v-if="order.shipping_eta_date">
                  📅 {{ order.shipping_eta_date }}
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>

    <!-- Shipped popup — opens when admin picks 'shipped' from the
         dropdown. Collects carrier (with datalist autosuggest fed from
         past orders), tracking code, and ETA date. Submit triggers
         POST /orders/{uuid}/admin-set-status/ which sends the
         customer email server-side. -->
    <AppModal
      :open="shippedModalOpen"
      title="Marcar como enviado"
      size="md"
      @close="cancelShippedPopup"
    >
      <div class="flex flex-col gap-4">
        <p class="text-sm text-text-muted">
          Completá los datos del envío. El cliente recibirá un email automático
          con el seguimiento.
        </p>

        <div class="flex flex-col gap-1">
          <label
            for="shipped-carrier"
            class="text-sm font-medium text-text"
          >
            Transportista
          </label>
          <input
            id="shipped-carrier"
            v-model="shippingCarrier"
            list="admin-known-carriers"
            type="text"
            placeholder="MRW, Correos, SEUR…"
            required
            data-testid="shipped-carrier"
            class="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus-visible:border-primary focus-visible:outline-none"
          >
          <datalist id="admin-known-carriers">
            <option
              v-for="c in knownCarriers"
              :key="c"
              :value="c"
            />
          </datalist>
        </div>

        <AppInput
          v-model="shippingTrackingCode"
          label="Código de seguimiento"
          placeholder="Ej. MRW123456789"
          required
          data-testid="shipped-tracking-code"
        />

        <div class="flex flex-col gap-1">
          <label
            for="shipped-eta"
            class="text-sm font-medium text-text"
          >
            Fecha estimada de entrega
          </label>
          <input
            id="shipped-eta"
            v-model="shippingEtaDate"
            type="date"
            data-testid="shipped-eta-date"
            class="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-text focus-visible:border-primary focus-visible:outline-none"
          >
          <p class="text-xs text-text-muted">
            Opcional. Se muestra al cliente en el email.
          </p>
        </div>
      </div>

      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <AppButton
            variant="ghost"
            type="button"
            @click="cancelShippedPopup"
          >
            Cancelar
          </AppButton>
          <AppButton
            :loading="isTransitioning"
            data-testid="shipped-submit"
            @click="submitShippedPopup"
          >
            Confirmar y enviar email
          </AppButton>
        </div>
      </template>
    </AppModal>
  </DashboardShell>
</template>
