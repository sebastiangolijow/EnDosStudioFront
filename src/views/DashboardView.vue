<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import DashboardShell from '@/components/layout/DashboardShell.vue'
import OrderHistoryCard from '@/components/order/OrderHistoryCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import { ordersService } from '@/services/orders.service'
import { useOrderStore } from '@/stores/order.store'
import { useToast } from '@/composables/useToast'
import { type Order, type OrderStatus, STATUS_LABELS } from '@/types/order'

const router = useRouter()
const orderStore = useOrderStore()
const toast = useToast()

type FilterValue = 'all' | OrderStatus

interface FilterPill {
  value: FilterValue
  label: string
}

/**
 * Filter pills in display order. "Todos" still hides drafts — drafts are
 * mid-edit and would clutter the regular order history with un-checkout-
 * able rows. They get their own pill ("Borradores") which shows ONLY
 * drafts, with a "Continuar editando" CTA on each card.
 */
const filters: FilterPill[] = [
  { value: 'all', label: 'Todos' },
  { value: 'draft', label: STATUS_LABELS.draft },
  { value: 'placed', label: STATUS_LABELS.placed },
  { value: 'paid', label: STATUS_LABELS.paid },
  { value: 'in_production', label: STATUS_LABELS.in_production },
  { value: 'shipped', label: STATUS_LABELS.shipped },
  { value: 'delivered', label: STATUS_LABELS.delivered },
  { value: 'cancelled', label: STATUS_LABELS.cancelled },
]

const activeFilter = ref<FilterValue>('all')
const isLoading = ref(false)

/** Visible orders after applying the active filter:
 *   - 'all'    → everything except drafts
 *   - 'draft'  → drafts only
 *   - other    → exact status match (drafts excluded by definition)
 */
const visibleOrders = computed<Order[]>(() => {
  if (activeFilter.value === 'all') {
    return orderStore.orderHistory.filter((o) => o.status !== 'draft')
  }
  return orderStore.orderHistory.filter((o) => o.status === activeFilter.value)
})

const totalCount = computed(
  () => orderStore.orderHistory.filter((o) => o.status !== 'draft').length,
)

async function fetchOrders() {
  isLoading.value = true
  try {
    const page = await ordersService.list()
    orderStore.setHistory(page.results)
  } catch {
    toast.error('No se pudieron cargar tus pedidos. Intentá de nuevo.')
  } finally {
    isLoading.value = false
  }
}

function startNewOrder() {
  router.push('/upload')
}

onMounted(fetchOrders)
</script>

<template>
  <DashboardShell>
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-h2 font-bold text-text">
          Mis pedidos
        </h1>
        <p class="mt-1 text-sm text-text-muted">
          Tus diseños, en orden cronológico.
        </p>
      </div>
      <AppButton
        size="md"
        @click="startNewOrder"
      >
        Nuevo pedido
      </AppButton>
    </header>

    <!-- Filter pills -->
    <div
      role="tablist"
      aria-label="Filtrar por estado"
      class="mt-6 flex flex-wrap gap-2"
    >
      <button
        v-for="filter in filters"
        :key="filter.value"
        type="button"
        role="tab"
        :aria-selected="activeFilter === filter.value"
        :class="[
          'rounded-full border px-3 py-1.5 text-sm transition',
          activeFilter === filter.value
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-surface-2 text-text-muted hover:bg-surface-1 hover:text-text',
        ]"
        :data-testid="`filter-${filter.value}`"
        @click="activeFilter = filter.value"
      >
        {{ filter.label }}
      </button>
    </div>

    <!-- Loading / empty / list -->
    <div class="mt-6">
      <div
        v-if="isLoading"
        class="rounded-lg border border-border bg-surface-2 p-12 text-center text-text-muted"
        data-testid="dashboard-loading"
      >
        Cargando pedidos...
      </div>

      <div
        v-else-if="totalCount === 0"
        class="rounded-lg border border-dashed border-border bg-surface-2 p-12 text-center"
        data-testid="dashboard-empty"
      >
        <p class="text-text">
          Aún no tenés pedidos.
        </p>
        <p class="mt-1 text-sm text-text-muted">
          Subí tu primer diseño y convertilo en stickers.
        </p>
        <AppButton
          class="mt-4"
          @click="startNewOrder"
        >
          Crear mi primer pedido
        </AppButton>
      </div>

      <div
        v-else-if="visibleOrders.length === 0"
        class="rounded-lg border border-dashed border-border bg-surface-2 p-12 text-center text-text-muted"
        data-testid="dashboard-no-match"
      >
        Ningún pedido en este estado.
      </div>

      <ul
        v-else
        class="flex flex-col gap-3"
        data-testid="dashboard-orders"
      >
        <li
          v-for="order in visibleOrders"
          :key="order.uuid"
        >
          <OrderHistoryCard :order="order" />
        </li>
      </ul>
    </div>

    <!-- Help footer -->
    <AppCard class="mt-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="font-semibold text-text">
          ¿Necesitás ayuda?
        </p>
        <p class="text-sm text-text-muted">
          Estamos acá para ayudarte.
        </p>
      </div>
      <AppButton variant="secondary">
        Contactar soporte
      </AppButton>
    </AppCard>
  </DashboardShell>
</template>
