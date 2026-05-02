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

const sizeLabel = computed(() => {
  if (!props.order.width_mm || !props.order.height_mm) return '—'
  return `${props.order.width_mm / 10}×${props.order.height_mm / 10} cm`
})

const materialLabel = computed(() =>
  props.order.material ? MATERIAL_LABELS[props.order.material] : '—',
)

const totalLabel = computed(() => `€${props.order.total_eur || '0.00'}`)

/** First original-image file URL, or null for placeholder. */
const thumbnailUrl = computed(() => {
  const original = props.order.files.find((f) => f.kind === 'original')
  return original?.file ?? null
})

function viewDetails() {
  router.push({ name: 'confirmation', params: { uuid: props.order.uuid } })
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
        {{ materialLabel }} · {{ sizeLabel }} · {{ order.quantity }} unidades
      </p>
    </div>

    <!-- Price + CTA -->
    <div class="flex flex-col items-end gap-2">
      <p class="font-semibold text-text">
        {{ totalLabel }}
      </p>
      <AppButton
        variant="secondary"
        size="sm"
        @click="viewDetails"
      >
        Ver detalles
      </AppButton>
    </div>
  </article>
</template>
