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
        class="absolute right-2 top-2 rounded-full bg-error/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
        data-testid="product-card-out-of-stock"
      >
        Sin stock
      </span>
    </div>

    <!-- Body — compact padding + smaller type so the card reads as a
         tile in a dense grid (2 cols mobile → 5 cols wide desktop).
         Description hidden on mobile (truncates the grid otherwise);
         shown line-clamped from sm:. -->
    <div class="flex flex-1 flex-col gap-1 p-3">
      <h3 class="line-clamp-2 text-sm font-semibold text-text">
        {{ product.name }}
      </h3>
      <p class="hidden line-clamp-2 text-xs text-text-muted sm:block">
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
          <span class="text-[10px] text-text-muted line-through">
            €{{ product.price_eur }}
          </span>
          <span class="text-base font-bold text-primary">
            €{{ product.sale_price_eur }}
          </span>
        </span>
        <span
          v-else
          class="text-base font-bold text-text"
        >
          €{{ product.price_eur }}
        </span>
        <span
          class="text-xs text-primary opacity-0 transition group-hover:opacity-100"
          aria-hidden="true"
        >Ver →</span>
      </div>
    </div>
  </RouterLink>
</template>
