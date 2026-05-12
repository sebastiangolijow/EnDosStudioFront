<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import type { ProductRef } from '@/types/product'

interface Props {
  /** From Order.product_detail (nested in OrderSerializer). */
  product: ProductRef | null
  productQuantity: number
  /** Pre-formatted "92.24" — comes from the order's total_eur. */
  totalEur: string
  /** Disable the CTA while a backend call is in flight. */
  ctaLoading?: boolean
  /** Hide the CTA when the summary is read-only (e.g. ConfirmationView). */
  hideCta?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  ctaLoading: false,
  hideCta: false,
})

defineEmits<{
  continue: []
}>()

const lineSubtotalEur = computed(() => {
  if (!props.product) return ''
  return ((props.product.price_cents * props.productQuantity) / 100).toFixed(2)
})

/** 21% IVA on the pre-IVA line subtotal — Spanish B2C convention. */
const ivaEur = computed(() => {
  if (!props.product) return ''
  const ivaCents = Math.round(props.product.price_cents * props.productQuantity * 0.21)
  return (ivaCents / 100).toFixed(2)
})

const productName = computed(() => props.product?.name ?? '—')
const unitPriceEur = computed(() => props.product?.price_eur ?? '')
</script>

<template>
  <aside
    class="rounded-lg border border-border bg-surface-1 p-5 shadow-card"
    data-testid="catalog-order-summary"
  >
    <h2 class="text-h3 font-semibold text-text">
      Resumen de tu pedido
    </h2>

    <!-- Product preview -->
    <div class="mt-4 aspect-square overflow-hidden rounded-md border border-border bg-surface-2">
      <img
        v-if="product?.image"
        :src="product.image"
        :alt="productName"
        class="size-full object-cover"
      >
      <div
        v-else
        class="size-full bg-holographic opacity-30"
        aria-hidden="true"
      />
    </div>

    <!-- Spec lines -->
    <dl class="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm">
      <div class="flex justify-between gap-3">
        <dt class="uppercase tracking-wide text-text-muted">
          Producto
        </dt>
        <dd class="font-medium text-text">
          {{ productName }}
        </dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="uppercase tracking-wide text-text-muted">
          Cantidad
        </dt>
        <dd class="font-medium text-text">
          {{ productQuantity }} unidad(es)
        </dd>
      </div>
      <div
        v-if="unitPriceEur"
        class="flex justify-between gap-3"
      >
        <dt class="uppercase tracking-wide text-text-muted">
          Precio unitario
        </dt>
        <dd class="font-medium text-text">
          €{{ unitPriceEur }}
        </dd>
      </div>
      <div
        v-if="lineSubtotalEur"
        class="flex justify-between gap-3"
      >
        <dt class="uppercase tracking-wide text-text-muted">
          Subtotal
        </dt>
        <dd class="font-medium text-text">
          €{{ lineSubtotalEur }}
        </dd>
      </div>
    </dl>

    <!-- Total -->
    <div class="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
      <div class="flex justify-between text-text-muted">
        <span>Envío</span>
        <span class="text-success">Gratis</span>
      </div>
      <div
        v-if="ivaEur"
        class="flex justify-between text-text-muted"
      >
        <span>IVA (21%)</span>
        <span data-testid="catalog-summary-iva">€{{ ivaEur }}</span>
      </div>
      <div class="mt-2 flex items-baseline justify-between border-t border-border pt-3">
        <span class="font-semibold text-text">Total</span>
        <span
          class="text-h3 font-bold text-text"
          data-testid="catalog-summary-total"
        >
          {{ totalEur ? `€${totalEur} EUR` : '—' }}
        </span>
      </div>
    </div>

    <AppButton
      v-if="!hideCta"
      class="mt-5 w-full"
      size="lg"
      :loading="ctaLoading"
      data-testid="catalog-summary-continue"
      @click="$emit('continue')"
    >
      Continuar al pago 🔒
    </AppButton>

    <p class="mt-3 text-center text-xs text-text-muted">
      🌍 Envíos a todo el mundo
    </p>
  </aside>
</template>
