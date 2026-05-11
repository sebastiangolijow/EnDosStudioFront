<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { productsService } from '@/services/products.service'
import { useToast } from '@/composables/useToast'
import type { Product } from '@/types/product'
import type { AsyncStatus } from '@/types/api'

const router = useRouter()
const toast = useToast()

const products = ref<Product[]>([])
const status = ref<AsyncStatus>('idle')

async function load() {
  status.value = 'loading'
  try {
    const page = await productsService.adminList()
    products.value = page.results
    status.value = 'success'
  } catch {
    status.value = 'error'
    toast.error('No pudimos cargar los productos.')
  }
}

async function toggleActive(product: Product) {
  try {
    const updated = await productsService.adminUpdate(product.slug, {
      is_active: !product.is_active,
    })
    // Splice in place so the UI reflects the change without re-sorting
    const idx = products.value.findIndex((p) => p.uuid === product.uuid)
    if (idx >= 0) products.value[idx] = updated
  } catch {
    toast.error('No pudimos cambiar el estado del producto.')
  }
}

async function deleteProduct(product: Product) {
  // Native confirm is good enough for an admin-only action. Replace with
  // <AppModal> later if the staff workflow needs richer confirmation
  // (e.g. type product name to confirm).
  const confirmed = window.confirm(
    `¿Eliminar "${product.name}" del catálogo? Esta acción no se puede deshacer.`,
  )
  if (!confirmed) return
  try {
    await productsService.adminDelete(product.slug)
    products.value = products.value.filter((p) => p.uuid !== product.uuid)
    toast.info(`"${product.name}" eliminado.`)
  } catch (e) {
    // Backend returns 409 with a friendly hint if the product has any
    // attached orders (PROTECT FK). Surface that message verbatim so the
    // shop owner knows to use is_active=false instead.
    const detail =
      (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
    toast.error(detail ?? 'No pudimos eliminar el producto.')
  }
}

function priceEur(cents: number): string {
  return (cents / 100).toFixed(2)
}

onMounted(load)
</script>

<template>
  <section class="px-8 py-12 md:px-12 lg:px-16">
    <header class="mb-8 flex items-end justify-between gap-6">
      <div>
        <h1 class="text-h1 font-bold uppercase tracking-tight text-primary">
          Productos
        </h1>
        <p class="mt-2 text-text-muted">
          Gestioná el catálogo: agregá nuevos productos, ajustá precios y stock,
          mostrá u ocultá del público.
        </p>
      </div>
      <AppButton
        size="lg"
        data-testid="admin-products-new"
        @click="router.push({ name: 'admin-product-new' })"
      >
        + Nuevo producto
      </AppButton>
    </header>

    <div
      v-if="status === 'loading'"
      class="py-12 text-center text-text-muted"
    >
      Cargando productos…
    </div>

    <div
      v-else-if="status === 'error'"
      class="py-12 text-center text-error"
    >
      No pudimos cargar el catálogo.
    </div>

    <div
      v-else-if="products.length === 0"
      class="py-12 text-center text-text-muted"
      data-testid="admin-products-empty"
    >
      Todavía no creaste ningún producto. Tocá "+ Nuevo producto" para empezar.
    </div>

    <div
      v-else
      class="overflow-hidden rounded-lg border border-border bg-surface-1"
      data-testid="admin-products-list"
    >
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-left uppercase tracking-wide text-text-muted">
          <tr>
            <th class="px-4 py-3">
              Producto
            </th>
            <th class="px-4 py-3">
              Precio
            </th>
            <th class="px-4 py-3">
              Stock
            </th>
            <th class="px-4 py-3">
              Estado
            </th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="product in products"
            :key="product.uuid"
            class="border-t border-border"
            :data-testid="`admin-product-row-${product.slug}`"
          >
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <div class="size-10 shrink-0 overflow-hidden rounded-sm border border-border bg-surface-2">
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
                <div class="min-w-0">
                  <p class="font-semibold text-text">
                    {{ product.name }}
                  </p>
                  <p class="text-xs text-text-muted">
                    {{ product.slug }}
                  </p>
                </div>
              </div>
            </td>
            <td class="px-4 py-3 font-medium text-text">
              €{{ priceEur(product.price_cents) }}
            </td>
            <td class="px-4 py-3 text-text">
              {{ product.stock_quantity }}
            </td>
            <td class="px-4 py-3">
              <button
                type="button"
                class="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
                :class="product.is_active
                  ? 'bg-success/15 text-success'
                  : 'bg-text-muted/15 text-text-muted'"
                :data-testid="`admin-product-toggle-${product.slug}`"
                @click="toggleActive(product)"
              >
                {{ product.is_active ? 'Activo' : 'Oculto' }}
              </button>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center justify-end gap-2">
                <AppButton
                  size="sm"
                  variant="ghost"
                  :data-testid="`admin-product-edit-${product.slug}`"
                  @click="router.push({ name: 'admin-product-edit', params: { slug: product.slug } })"
                >
                  Editar
                </AppButton>
                <button
                  type="button"
                  class="rounded-md border border-transparent px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10"
                  :data-testid="`admin-product-delete-${product.slug}`"
                  @click="deleteProduct(product)"
                >
                  Borrar
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
