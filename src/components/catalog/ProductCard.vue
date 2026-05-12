<script setup lang="ts">
import type { Product } from '@/types/product'

defineProps<{
  product: Product
}>()
</script>

<template>
  <RouterLink
    :to="`/catalogo/${product.slug}`"
    class="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-card transition hover:border-primary"
    :data-testid="`product-card-${product.slug}`"
  >
    <!-- Image (or holographic placeholder when product has no image) -->
    <div class="relative aspect-square overflow-hidden bg-surface-2">
      <img
        v-if="product.image"
        :src="product.image"
        :alt="product.name"
        class="size-full object-cover transition group-hover:scale-105"
        loading="lazy"
        decoding="async"
      >
      <div
        v-else
        class="size-full bg-holographic opacity-30"
        aria-hidden="true"
      />

      <span
        v-if="product.stock_quantity === 0"
        class="absolute right-3 top-3 rounded-full bg-error/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
        data-testid="product-card-out-of-stock"
      >
        Sin stock
      </span>
    </div>

    <!-- Body -->
    <div class="flex flex-1 flex-col gap-2 p-4">
      <h3 class="text-base font-semibold text-text">
        {{ product.name }}
      </h3>
      <p class="line-clamp-2 text-sm text-text-muted">
        {{ product.description }}
      </p>
      <div class="mt-auto flex items-baseline justify-between pt-2">
        <!-- Price block: strikethrough + sale price when sale_price_eur
             is set, plain price otherwise. -->
        <span
          v-if="product.sale_price_eur"
          class="flex flex-col leading-tight"
          data-testid="product-card-sale-price"
        >
          <span class="text-xs text-text-muted line-through">
            €{{ product.price_eur }}
          </span>
          <span class="text-h3 font-bold text-primary">
            €{{ product.sale_price_eur }}
          </span>
        </span>
        <span
          v-else
          class="text-h3 font-bold text-text"
        >
          €{{ product.price_eur }}
        </span>
        <span
          class="text-sm text-primary opacity-0 transition group-hover:opacity-100"
          aria-hidden="true"
        >Ver →</span>
      </div>
    </div>
  </RouterLink>
</template>
