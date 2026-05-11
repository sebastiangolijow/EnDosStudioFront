<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { type Order, MATERIAL_LABELS } from '@/types/order'
import AppButton from '@/components/ui/AppButton.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'

interface Props {
  order: Order
}

const props = defineProps<Props>()
const router = useRouter()

/** Short ID for display (matching the mockup's "Pedido #1247" style). */
const shortId = computed(() => `#${props.order.uuid.slice(0, 8)}`)

const formattedDate = computed(() => {
  if (!props.order.placed_at && !props.order.created_at) return ''
  const iso = props.order.placed_at ?? props.order.created_at
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
})

const isCatalogOrder = computed<boolean>(() => props.order.kind === 'catalog')

const sizeLabel = computed(() => {
  if (!props.order.width_mm || !props.order.height_mm) return '—'
  return `${props.order.width_mm / 10}×${props.order.height_mm / 10} cm`
})

const materialLabel = computed(() =>
  props.order.material ? MATERIAL_LABELS[props.order.material] : '—',
)

/** Display caption for the second info line: kind-aware. */
const itemLine = computed(() => {
  if (isCatalogOrder.value) {
    const name = props.order.product_detail?.name ?? '—'
    return `${name} · ${props.order.product_quantity} unidad(es)`
  }
  return `${materialLabel.value} · ${sizeLabel.value} · ${props.order.quantity} unidades`
})

const totalLabel = computed(() => `€${props.order.total_eur || '0.00'}`)

/** Catalog: product image. Sticker: original-upload thumbnail. */
const thumbnailUrl = computed(() => {
  if (isCatalogOrder.value) {
    return props.order.product_detail?.image ?? null
  }
  const original = props.order.files.find((f) => f.kind === 'original')
  return original?.file ?? null
})

const isDraft = computed<boolean>(() => props.order.status === 'draft')

function viewDetails() {
  router.push({ name: 'confirmation', params: { uuid: props.order.uuid } })
}

/** For drafts: route back to the editor (sticker drafts) or to the
 *  product detail (catalog drafts). Catalog drafts are rare in practice
 *  — they're only created mid-checkout — but we handle them so the CTA
 *  never strands the customer. */
function continueEditing() {
  if (isCatalogOrder.value) {
    const slug = props.order.product_detail?.slug
    if (slug) router.push({ name: 'catalog-detail', params: { slug } })
    else router.push('/catalogo')
    return
  }
  router.push({ name: 'editor', params: { uuid: props.order.uuid } })
}
</script>

<template>
  <article
    class="flex items-center gap-4 rounded-lg border border-border bg-surface-1 p-4 shadow-card"
    :data-testid="`order-card-${order.uuid}`"
  >
    <!-- Thumbnail (square, 64px) -->
    <div
      class="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2"
      aria-hidden="true"
    >
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        :alt="`Diseño del pedido ${shortId}`"
        class="size-full object-cover"
      >
      <!-- Placeholder when no original uploaded yet (drafts) -->
      <div
        v-else
        class="size-full bg-holographic opacity-30"
      />
    </div>

    <!-- Main info column -->
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p class="font-semibold text-text">
          Pedido {{ shortId }}
        </p>
        <p
          v-if="formattedDate"
          class="text-xs text-text-muted"
        >
          {{ formattedDate }}
        </p>
        <StatusBadge :status="order.status" />
      </div>
      <p class="mt-1 truncate text-sm text-text-muted">
        {{ itemLine }}
      </p>
    </div>

    <!-- Price + CTA. Drafts get a "Continuar editando" CTA that routes
         back to the editor; price hidden because total_amount_cents
         stays 0 until place_order runs (would read €0.00 otherwise). -->
    <div class="flex flex-col items-end gap-2">
      <p
        v-if="!isDraft"
        class="font-semibold text-text"
      >
        {{ totalLabel }}
      </p>
      <AppButton
        v-if="isDraft"
        size="sm"
        :data-testid="`draft-continue-${order.uuid}`"
        @click="continueEditing"
      >
        Continuar editando
      </AppButton>
      <AppButton
        v-else
        variant="secondary"
        size="sm"
        @click="viewDetails"
      >
        Ver detalles
      </AppButton>
    </div>
  </article>
</template>
