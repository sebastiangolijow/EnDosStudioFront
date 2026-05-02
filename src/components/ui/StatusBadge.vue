<script setup lang="ts">
import { computed } from 'vue'
import { type OrderStatus, STATUS_LABELS } from '@/types/order'

interface Props {
  status: OrderStatus
}

const props = defineProps<Props>()

/**
 * Color mapping per status. The semantic tokens (success/warning/info/error)
 * already exist in tokens.css + tailwind config.
 *
 * - draft         → muted: it's not "live" yet
 * - placed        → warning: customer awaiting payment
 * - paid          → info: paid, waiting for the shop to act
 * - in_production → warning: in motion
 * - shipped       → info: in motion
 * - delivered     → success: terminal happy
 * - cancelled     → error: terminal sad
 */
const variantClasses: Record<OrderStatus, string> = {
  draft: 'bg-surface-2 text-text-muted border-border',
  placed: 'bg-warning/10 text-warning border-warning/40',
  paid: 'bg-holo-cyan/10 text-holo-cyan border-holo-cyan/40',
  in_production: 'bg-warning/10 text-warning border-warning/40',
  shipped: 'bg-holo-cyan/10 text-holo-cyan border-holo-cyan/40',
  delivered: 'bg-success/10 text-success border-success/40',
  cancelled: 'bg-error/10 text-error border-error/40',
}

const classes = computed(
  () =>
    `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${variantClasses[props.status]}`,
)
</script>

<template>
  <span :class="classes">
    {{ STATUS_LABELS[status] }}
  </span>
</template>
