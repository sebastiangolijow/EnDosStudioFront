<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import ProductCard from '@/components/catalog/ProductCard.vue'
import { productsService } from '@/services/products.service'
import { useAuthStore } from '@/stores/auth.store'
import type { Product } from '@/types/product'
import type { AsyncStatus } from '@/types/api'

const router = useRouter()
const auth = useAuthStore()

const products = ref<Product[]>([])
const status = ref<AsyncStatus>('idle')
const errorMessage = ref<string>('')

async function load() {
  status.value = 'loading'
  try {
    const page = await productsService.list()
    products.value = page.results
    status.value = 'success'
  } catch (e) {
    errorMessage.value = String(e)
    status.value = 'error'
  }
}

onMounted(load)
</script>

<template>
  <section class="px-8 py-12 md:px-12 lg:px-16">
    <header class="mb-10 flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-h1 font-bold uppercase tracking-tight text-primary">
        Catálogo
      </h1>
      <div
        v-if="auth.isShopStaff"
        class="flex items-center gap-2"
        data-testid="catalog-admin-actions"
      >
        <AppButton
          variant="ghost"
          size="sm"
          @click="router.push({ name: 'admin-products' })"
        >
          Gestionar productos
        </AppButton>
        <AppButton
          size="sm"
          data-testid="catalog-admin-new-product"
          @click="router.push({ name: 'admin-product-new' })"
        >
          + Nuevo producto
        </AppButton>
      </div>
    </header>

    <!-- Loading / error / empty / grid -->
    <div
      v-if="status === 'loading'"
      class="grid place-items-center py-20 text-text-muted"
      data-testid="catalog-loading"
    >
      Cargando productos…
    </div>

    <div
      v-else-if="status === 'error'"
      class="grid place-items-center py-20 text-error"
      data-testid="catalog-error"
    >
      No pudimos cargar el catálogo. Recargá la página o probá más tarde.
    </div>

    <div
      v-else-if="products.length === 0"
      class="grid place-items-center py-20 text-text-muted"
      data-testid="catalog-empty"
    >
      Todavía no hay productos en el catálogo. Volvé pronto.
    </div>

    <!-- Catalog grid — denser layout: 2 cols on mobile, scaling up to
         5 on wide desktop. Larger gap (gap-6 / lg:gap-8) gives the
         cards breathing room without the page feeling sparse. -->
    <div
      v-else
      class="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 lg:gap-8 xl:grid-cols-5"
      data-testid="catalog-grid"
    >
      <ProductCard
        v-for="product in products"
        :key="product.uuid"
        :product="product"
      />
    </div>
  </section>
</template>
