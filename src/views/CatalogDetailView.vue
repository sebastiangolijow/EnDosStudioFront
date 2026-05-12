<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { ordersService } from '@/services/orders.service'
import { productsService } from '@/services/products.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import type { Product } from '@/types/product'
import type { AsyncStatus } from '@/types/api'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const product = ref<Product | null>(null)
const loadStatus = ref<AsyncStatus>('idle')
const buyStatus = ref<AsyncStatus>('idle')
const quantity = ref<number>(1)

const slug = computed(() => route.params.slug as string)

/**
 * All-in total with 21% IVA. effective_price_cents picks sale_price_cents
 * when set, else price_cents — same logic the backend uses in
 * _compute_catalog_total_cents. Multiply by 1.21 for the customer-facing
 * total (Spanish B2C convention).
 */
const totalEur = computed(() => {
  if (!product.value) return ''
  const allInCents = Math.round(
    product.value.effective_price_cents * quantity.value * 1.21,
  )
  return (allInCents / 100).toFixed(2)
})

/**
 * Staff (admin / shop_staff) browse the catalog as a QA / preview
 * tool but shouldn't be able to actually purchase — their account
 * isn't a customer account. We disable Comprar instead of hiding
 * the whole product so staff can still see the discounted price and
 * the buy CTA copy.
 */
const isStaff = computed(() => auth.isShopStaff)

const canBuy = computed(() => {
  if (isStaff.value) return false
  return (
    !!product.value &&
    product.value.is_active &&
    product.value.stock_quantity > 0 &&
    quantity.value >= 1 &&
    quantity.value <= product.value.stock_quantity
  )
})

async function load() {
  loadStatus.value = 'loading'
  try {
    product.value = await productsService.getBySlug(slug.value)
    loadStatus.value = 'success'
  } catch {
    loadStatus.value = 'error'
  }
}

function decreaseQty() {
  if (quantity.value > 1) quantity.value -= 1
}

function increaseQty() {
  if (product.value && quantity.value < product.value.stock_quantity) quantity.value += 1
}

async function onBuy() {
  if (!product.value || !canBuy.value) return

  if (!auth.isAuthenticated) {
    router.push({ name: 'login', query: { next: route.fullPath } })
    return
  }

  buyStatus.value = 'loading'
  try {
    const order = await ordersService.createCatalogOrder({
      product: product.value.uuid,
      product_quantity: quantity.value,
    })
    buyStatus.value = 'success'
    router.push({ name: 'checkout', params: { uuid: order.uuid } })
  } catch (e) {
    const detail =
      (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
      'No pudimos crear tu pedido. Intentá de nuevo.'
    toast.error(detail)
    buyStatus.value = 'error'
  }
}

onMounted(load)
</script>

<template>
  <section class="px-8 py-12 md:px-12 lg:px-16">
    <RouterLink
      to="/catalogo"
      class="mb-6 inline-block text-sm text-text-muted hover:text-text"
    >
      ← Volver al catálogo
    </RouterLink>

    <div
      v-if="loadStatus === 'loading'"
      class="py-20 text-center text-text-muted"
      data-testid="product-detail-loading"
    >
      Cargando producto…
    </div>

    <div
      v-else-if="loadStatus === 'error' || !product"
      class="py-20 text-center text-error"
      data-testid="product-detail-error"
    >
      Producto no encontrado.
    </div>

    <div
      v-else
      class="grid gap-12 lg:grid-cols-2"
      data-testid="product-detail"
    >
      <!-- Image -->
      <div class="aspect-square overflow-hidden rounded-xl border border-border bg-surface-1">
        <img
          v-if="product.image"
          :src="product.image"
          :alt="product.name"
          class="size-full object-cover"
        >
        <div
          v-else
          class="size-full bg-holographic opacity-30"
          aria-hidden="true"
        />
      </div>

      <!-- Body -->
      <div class="flex flex-col gap-6">
        <h1 class="text-h1 font-bold uppercase tracking-tight text-text">
          {{ product.name }}
        </h1>

        <p
          v-if="product.description"
          class="whitespace-pre-line text-base text-text-muted"
        >
          {{ product.description }}
        </p>

        <div class="border-y border-border py-6">
          <!-- Unit price: when sale_price_eur is set, show the original
               with a strikethrough above the discounted price. -->
          <div
            v-if="product.sale_price_eur"
            class="flex items-baseline gap-3"
            data-testid="product-sale-price"
          >
            <p class="text-h3 font-medium text-text-muted line-through">
              €{{ product.price_eur }}
            </p>
            <p class="text-h2 font-bold text-primary">
              €{{ product.sale_price_eur }}
            </p>
          </div>
          <p
            v-else
            class="text-h2 font-bold text-primary"
          >
            €{{ product.price_eur }}
          </p>
          <p
            v-if="product.stock_quantity > 0"
            class="mt-2 text-sm text-text-muted"
            data-testid="product-stock"
          >
            {{ product.stock_quantity }} unidad(es) disponibles
          </p>
          <p
            v-else
            class="mt-2 text-sm font-semibold text-error"
            data-testid="product-out-of-stock"
          >
            Sin stock
          </p>
        </div>

        <!-- Quantity stepper -->
        <div class="flex items-center gap-3">
          <span class="text-sm uppercase tracking-wide text-text-muted">Cantidad</span>
          <div class="flex items-center overflow-hidden rounded-md border border-border">
            <button
              type="button"
              class="px-3 py-2 text-text hover:bg-surface-2 disabled:opacity-50"
              :disabled="quantity <= 1 || product.stock_quantity === 0"
              data-testid="qty-decrease"
              @click="decreaseQty"
            >
              −
            </button>
            <span
              class="min-w-[3ch] px-3 py-2 text-center text-text"
              data-testid="qty-value"
            >
              {{ quantity }}
            </span>
            <button
              type="button"
              class="px-3 py-2 text-text hover:bg-surface-2 disabled:opacity-50"
              :disabled="!canBuy || quantity >= product.stock_quantity"
              data-testid="qty-increase"
              @click="increaseQty"
            >
              +
            </button>
          </div>
        </div>

        <!-- Total preview -->
        <div class="flex items-baseline justify-between border-t border-border pt-6">
          <span class="text-sm uppercase tracking-wide text-text-muted">Total</span>
          <span
            class="text-h3 font-bold text-text"
            data-testid="product-total"
          >
            €{{ totalEur }}
          </span>
        </div>

        <!-- CTA — disabled for staff (they can't be customers). The
             button stays visible so the page layout matches what
             customers see, but a helper line under it explains why
             it's greyed out. -->
        <AppButton
          size="lg"
          :loading="buyStatus === 'loading'"
          :disabled="!canBuy"
          data-testid="product-buy"
          @click="onBuy"
        >
          Comprar
        </AppButton>
        <p
          v-if="isStaff"
          class="text-center text-xs text-text-muted"
          data-testid="product-buy-staff-notice"
        >
          Las cuentas de administración no pueden comprar productos del catálogo.
        </p>
      </div>
    </div>
  </section>
</template>
