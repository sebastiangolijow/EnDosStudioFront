<script setup lang="ts">
/**
 * Admin orders screen — the shop owner's command center.
 *
 * Workflow this is optimized for:
 *   - Morning routine: see what came in overnight, what's in the action queue.
 *   - During the day: customer asks about their order → search by email/uuid.
 *   - Production: pick the next paid order, mark in_production, mark shipped.
 *   - Edge cases: manual mark-as-paid for bank-transfer / cash orders.
 *
 * Layout:
 *   - Status count cards (top): 7 cards, one per status (Borradores
 *     included so the owner can see in-progress customer carts).
 *     Highlights Paid (action queue). Clicking a card filters the list below.
 *   - Filter + search bar: status pills, search input, date range, page size.
 *   - Order table: customer name + email, item summary, total, status,
 *     date, plus inline quick-action button driven by current status:
 *       placed         → Marcar como pagado (staff manual fallback)
 *       paid           → Iniciar producción
 *       in_production  → Marcar enviado
 *       any            → Ver detalle (always)
 *
 * Server-driven: every filter/search/sort/page-size change hits the
 * backend. At 50 orders/day volume, client-side filtering would break
 * within ~2 days. The 800ms debounce on the search input gives a typing
 * customer time to finish.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import DashboardShell from '@/components/layout/DashboardShell.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { ordersService } from '@/services/orders.service'
import { useToast } from '@/composables/useToast'
import {
  type Order,
  type OrderListParams,
  type OrderStatus,
  MATERIAL_LABELS,
  STATUS_LABELS,
} from '@/types/order'

const router = useRouter()
const toast = useToast()

// === Filter state ===
type StatusFilter = OrderStatus | 'all'
const statusFilter = ref<StatusFilter>('all')
const searchInput = ref<string>('')
const debouncedSearch = ref<string>('')
const dateFrom = ref<string>('') // <input type="date"> value, YYYY-MM-DD
const dateTo = ref<string>('')
const pageSize = ref<number>(25)
const page = ref<number>(1)

// === Data ===
const orders = ref<Order[]>([])
const totalCount = ref<number>(0)
const isLoading = ref<boolean>(false)
const isMutating = ref<Set<string>>(new Set()) // uuid set; per-row spinner

// Per-status counts shown in the dashboard cards at top. Loaded separately
// from the main list so they always reflect the FULL inventory regardless
// of the current filter. Triggered alongside fetchOrders.
const statusCounts = ref<Record<OrderStatus, number>>({
  draft: 0,
  placed: 0,
  reserved: 0,
  paid: 0,
  in_production: 0,
  shipped: 0,
  delivered: 0,
  cancelled: 0,
})

// Status counts shown in the cards row. Order matches workflow priority:
// paid first (the action queue), then production, then "done" states.
// 'draft' lives at the end — useful to spot abandoned carts the owner
// might want to follow up on, but never the first thing to triage.
const STATUS_CARDS: { value: OrderStatus; label: string; emphasize?: boolean }[] = [
  { value: 'paid', label: STATUS_LABELS.paid, emphasize: true },
  // Reservations sit near the top of the queue — the owner needs to
  // remember them for cash-on-pickup day.
  { value: 'reserved', label: STATUS_LABELS.reserved, emphasize: true },
  { value: 'in_production', label: STATUS_LABELS.in_production },
  { value: 'placed', label: STATUS_LABELS.placed },
  { value: 'shipped', label: STATUS_LABELS.shipped },
  { value: 'delivered', label: STATUS_LABELS.delivered },
  { value: 'cancelled', label: STATUS_LABELS.cancelled },
  { value: 'draft', label: STATUS_LABELS.draft },
]

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  ...STATUS_CARDS.map((c) => ({ value: c.value as StatusFilter, label: c.label })),
]

const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize.value)))

/**
 * Build the params object for the current filter state. Empty strings
 * stay as undefined so the service skips them.
 */
function currentParams(): OrderListParams {
  return {
    status: statusFilter.value === 'all' ? undefined : statusFilter.value,
    search: debouncedSearch.value || undefined,
    ordering: '-created_at',
    created_after: dateFrom.value ? `${dateFrom.value}T00:00:00Z` : undefined,
    created_before: dateTo.value ? `${dateTo.value}T23:59:59Z` : undefined,
    page: page.value,
    page_size: pageSize.value,
  }
}

async function fetchOrders() {
  isLoading.value = true
  try {
    const result = await ordersService.list(currentParams())
    orders.value = result.results
    totalCount.value = result.count
  } catch {
    toast.error('No pudimos cargar los pedidos.')
  } finally {
    isLoading.value = false
  }
}

/**
 * Counts query — one request per status, run in parallel. The backend
 * doesn't return counts grouped by status in a single response, so we
 * fan out. Cheap because each query is paginated (`page_size=1`); we
 * only read `count` off the response, never the rows.
 */
async function fetchStatusCounts() {
  const statuses: OrderStatus[] = [
    'draft',
    'placed',
    'reserved',
    'paid',
    'in_production',
    'shipped',
    'delivered',
    'cancelled',
  ]
  const results = await Promise.allSettled(
    statuses.map((s) => ordersService.list({ status: s, page_size: 1, page: 1 })),
  )
  results.forEach((r, i) => {
    const status = statuses[i]
    if (r.status === 'fulfilled') {
      statusCounts.value[status] = r.value.count
    }
  })
}

// Debounce the search input — 800 ms after last keystroke before firing.
// Resets to page 1 on every search change.
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = v
    page.value = 1
  }, 800)
})

// Any filter change resets pagination to page 1 then refetches.
watch([statusFilter, debouncedSearch, dateFrom, dateTo, pageSize], () => {
  page.value = 1
  fetchOrders()
})

// Page-only change just refetches.
watch(page, fetchOrders)

onMounted(() => {
  fetchOrders()
  fetchStatusCounts()
})

// === Row formatters ===

function shortId(uuid: string): string {
  return `#${uuid.slice(0, 8)}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function itemSummary(order: Order): string {
  if (order.kind === 'catalog') {
    const name = order.product_detail?.name ?? '—'
    return `${name} · ${order.product_quantity}u`
  }
  const material = order.material ? MATERIAL_LABELS[order.material] : '—'
  const size = order.width_mm && order.height_mm
    ? `${order.width_mm / 10}×${order.height_mm / 10} cm`
    : '—'
  return `${material} · ${size} · ${order.quantity}u`
}

// === Inline quick actions ===
//
// Each row has at most one quick-action button keyed to its current
// status. Confirmation dialogs only for irreversible ops; the
// status transitions are themselves reversible via the cancel/admin
// flows, so a click + toast is enough feedback.

interface QuickAction {
  label: string
  testid: string
  action: (uuid: string) => Promise<Order>
  /** Toast message on success. {{name}} interpolated to the order short-ID. */
  successMsg: string
}

function quickActionFor(order: Order): QuickAction | null {
  if (order.status === 'placed') {
    return {
      label: 'Marcar como pagado',
      testid: `admin-row-mark-paid-${order.uuid}`,
      action: (uuid) => ordersService.markPaid(uuid),
      successMsg: `Pedido {{name}} marcado como pagado.`,
    }
  }
  if (order.status === 'paid') {
    return {
      label: 'Iniciar producción',
      testid: `admin-row-start-production-${order.uuid}`,
      action: (uuid) => ordersService.startProduction(uuid),
      successMsg: `Pedido {{name}} en producción.`,
    }
  }
  if (order.status === 'in_production') {
    return {
      label: 'Marcar enviado',
      testid: `admin-row-ship-${order.uuid}`,
      action: (uuid) => ordersService.ship(uuid),
      successMsg: `Pedido {{name}} marcado como enviado.`,
    }
  }
  return null
}

async function runQuickAction(order: Order) {
  const act = quickActionFor(order)
  if (!act) return
  if (isMutating.value.has(order.uuid)) return
  const next = new Set(isMutating.value)
  next.add(order.uuid)
  isMutating.value = next
  try {
    const updated = await act.action(order.uuid)
    // Splice in place; the cards' counts need a refetch though.
    const idx = orders.value.findIndex((o) => o.uuid === order.uuid)
    if (idx >= 0) orders.value[idx] = updated
    toast.success(act.successMsg.replace('{{name}}', shortId(order.uuid)))
    // Refresh counts so the dashboard cards reflect the transition.
    fetchStatusCounts()
  } catch (e) {
    const detail =
      (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    toast.error(detail ?? 'No pudimos completar la acción.')
  } finally {
    const next2 = new Set(isMutating.value)
    next2.delete(order.uuid)
    isMutating.value = next2
  }
}

function openDetail(uuid: string) {
  router.push({ name: 'admin-order-detail', params: { uuid } })
}
</script>

<template>
  <DashboardShell>
    <header class="mb-8">
      <h1 class="text-h2 font-bold text-text">
        Pedidos
      </h1>
      <p class="mt-2 text-text-muted">
        Gestioná los pedidos: marcá como pagado, iniciá producción, registrá envíos.
      </p>
    </header>

    <!-- Status cards row — quick glance at queue depth -->
    <div
      class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      data-testid="admin-orders-status-cards"
    >
      <button
        v-for="card in STATUS_CARDS"
        :key="card.value"
        type="button"
        :class="[
          'flex flex-col items-start rounded-lg border p-4 text-left transition',
          card.emphasize && 'border-primary bg-primary/5',
          !card.emphasize && 'border-border bg-surface-1',
          statusFilter === card.value && 'ring-2 ring-primary',
          'hover:border-primary/60',
        ]"
        :data-testid="`status-card-${card.value}`"
        @click="statusFilter = card.value"
      >
        <p class="text-sm text-text-muted">
          {{ card.label }}
        </p>
        <p :class="['mt-1 text-3xl font-bold', card.emphasize ? 'text-primary' : 'text-text']">
          {{ statusCounts[card.value] }}
        </p>
      </button>
    </div>

    <!-- Filter / search bar -->
    <div class="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end">
      <!-- Search input -->
      <div>
        <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-text-muted">
          Buscar
        </label>
        <input
          v-model="searchInput"
          type="text"
          placeholder="Email, nombre, destinatario o ID de pedido"
          class="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none"
          data-testid="admin-orders-search"
        >
      </div>
      <!-- Date range -->
      <div>
        <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-text-muted">
          Desde
        </label>
        <input
          v-model="dateFrom"
          type="date"
          class="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          data-testid="admin-orders-date-from"
        >
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-text-muted">
          Hasta
        </label>
        <input
          v-model="dateTo"
          type="date"
          class="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          data-testid="admin-orders-date-to"
        >
      </div>
      <!-- Page size -->
      <div>
        <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-text-muted">
          Por página
        </label>
        <select
          v-model.number="pageSize"
          class="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          data-testid="admin-orders-page-size"
        >
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </div>
    </div>

    <!-- Status pills -->
    <div
      class="mb-4 flex flex-wrap gap-2"
      role="tablist"
    >
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.value"
        type="button"
        role="tab"
        :class="[
          'rounded-full border px-3 py-1.5 text-sm transition',
          statusFilter === f.value
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-text-muted hover:text-text',
        ]"
        :data-testid="`status-filter-${f.value}`"
        :aria-selected="statusFilter === f.value"
        @click="statusFilter = f.value"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Orders table -->
    <div
      v-if="isLoading && orders.length === 0"
      class="py-12 text-center text-text-muted"
    >
      Cargando pedidos…
    </div>

    <div
      v-else-if="orders.length === 0"
      class="py-12 text-center text-text-muted"
      data-testid="admin-orders-empty"
    >
      No hay pedidos que coincidan con los filtros actuales.
    </div>

    <div
      v-else
      class="overflow-hidden rounded-lg border border-border bg-surface-1"
      data-testid="admin-orders-list"
    >
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-left uppercase tracking-wide text-text-muted">
          <tr>
            <th class="px-4 py-3">Pedido</th>
            <th class="px-4 py-3">Cliente</th>
            <th class="px-4 py-3">Producto</th>
            <th class="px-4 py-3">Total</th>
            <th class="px-4 py-3">Estado</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="order in orders"
            :key="order.uuid"
            class="cursor-pointer border-t border-border transition hover:bg-surface-2"
            :data-testid="`admin-order-row-${order.uuid}`"
            @click="openDetail(order.uuid)"
          >
            <td class="px-4 py-3">
              <p class="font-mono text-xs font-semibold text-text">
                {{ shortId(order.uuid) }}
              </p>
              <p class="mt-0.5 text-xs text-text-muted">
                {{ formatDate(order.created_at) }}
              </p>
            </td>
            <td class="px-4 py-3">
              <p class="font-medium text-text">
                {{ order.customer_name || '—' }}
              </p>
              <p class="text-xs text-text-muted">
                {{ order.customer_email || '—' }}
              </p>
            </td>
            <td class="px-4 py-3 text-text">
              {{ itemSummary(order) }}
            </td>
            <td class="px-4 py-3 font-medium text-text">
              €{{ order.total_eur || '0.00' }}
            </td>
            <td class="px-4 py-3">
              <StatusBadge :status="order.status" />
            </td>
            <td class="px-4 py-3">
              <div
                class="flex items-center justify-end gap-2"
                @click.stop
              >
                <button
                  v-if="quickActionFor(order)"
                  type="button"
                  class="rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="isMutating.has(order.uuid)"
                  :data-testid="quickActionFor(order)!.testid"
                  @click="runQuickAction(order)"
                >
                  {{ quickActionFor(order)!.label }}
                </button>
                <AppButton
                  variant="ghost"
                  size="sm"
                  :data-testid="`admin-order-detail-${order.uuid}`"
                  @click.stop="openDetail(order.uuid)"
                >
                  Ver detalle
                </AppButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div
      v-if="totalCount > pageSize"
      class="mt-4 flex items-center justify-between gap-4"
      data-testid="admin-orders-pagination"
    >
      <p class="text-sm text-text-muted">
        {{ (page - 1) * pageSize + 1 }}–{{ Math.min(page * pageSize, totalCount) }}
        de {{ totalCount }}
      </p>
      <div class="flex items-center gap-2">
        <AppButton
          variant="ghost"
          size="sm"
          :disabled="page === 1"
          @click="page = page - 1"
        >
          ← Anterior
        </AppButton>
        <p class="px-2 text-sm text-text-muted">
          {{ page }} / {{ totalPages }}
        </p>
        <AppButton
          variant="ghost"
          size="sm"
          :disabled="page >= totalPages"
          @click="page = page + 1"
        >
          Siguiente →
        </AppButton>
      </div>
    </div>
  </DashboardShell>
</template>
