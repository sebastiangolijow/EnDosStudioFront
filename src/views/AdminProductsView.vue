<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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

// === Bulk selection ===
//
// `selectedSlugs` is the source of truth for which rows are checked.
// Using a Set for O(1) has/add/delete; products are keyed by slug
// because that's what the backend's DELETE endpoint takes and what
// reads naturally in the bulk handler.
//
// The header checkbox is a master "select all visible" toggle —
// indeterminate when some-but-not-all rows are selected. Clicking it
// flips to "all selected" if any are unselected, else clears all.
//
// Bulk-delete is a frontend fan-out: Promise.allSettled over the
// selected slugs. The backend doesn't have a bulk endpoint and
// probably doesn't need one — catalog admin is low-frequency and
// even 50 sequential DELETEs are sub-second. The per-product 409
// FK-protection error (a product with orders can't be deleted) is
// reported in the summary toast.
const selectedSlugs = ref<Set<string>>(new Set())
const isBulkDeleting = ref<boolean>(false)

const allVisibleSelected = computed<boolean>(
  () => products.value.length > 0 && products.value.every((p) => selectedSlugs.value.has(p.slug)),
)
const someVisibleSelected = computed<boolean>(
  () => products.value.some((p) => selectedSlugs.value.has(p.slug)) && !allVisibleSelected.value,
)

function toggleRow(slug: string, checked: boolean) {
  const next = new Set(selectedSlugs.value)
  if (checked) next.add(slug)
  else next.delete(slug)
  selectedSlugs.value = next
}

function toggleAll() {
  if (allVisibleSelected.value) {
    selectedSlugs.value = new Set()
  } else {
    selectedSlugs.value = new Set(products.value.map((p) => p.slug))
  }
}

function clearSelection() {
  selectedSlugs.value = new Set()
}

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

/**
 * Bulk-delete every product whose slug is in selectedSlugs. Confirms
 * once, fans out DELETEs in parallel, reports a summary of successes +
 * failures (FK-protected products show "tiene pedidos asociados" or
 * whatever detail the backend returned).
 *
 * Successful deletes are removed from the local products list and
 * cleared from the selection. Failed slugs stay selected so the
 * staff can retry or uncheck them.
 */
async function bulkDeleteSelected() {
  const slugs = Array.from(selectedSlugs.value)
  if (slugs.length === 0) return
  const confirmed = window.confirm(
    `¿Eliminar ${slugs.length} producto${slugs.length === 1 ? '' : 's'}? Esta acción no se puede deshacer.`,
  )
  if (!confirmed) return
  isBulkDeleting.value = true
  // Capture name + slug pairs BEFORE the deletes so we can report
  // failures by name (the products array gets pruned on success).
  const nameBySlug = new Map(products.value.map((p) => [p.slug, p.name]))
  try {
    const results = await Promise.allSettled(
      slugs.map((slug) => productsService.adminDelete(slug)),
    )
    const succeededSlugs: string[] = []
    const failedReasons: string[] = []
    results.forEach((r, i) => {
      const slug = slugs[i]
      if (r.status === 'fulfilled') {
        succeededSlugs.push(slug)
      } else {
        const detail =
          (r.reason as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        const name = nameBySlug.get(slug) ?? slug
        failedReasons.push(`"${name}": ${detail ?? 'error desconocido'}`)
      }
    })
    // Apply successes: drop from products + selection.
    if (succeededSlugs.length > 0) {
      const succeededSet = new Set(succeededSlugs)
      products.value = products.value.filter((p) => !succeededSet.has(p.slug))
      const nextSelected = new Set(selectedSlugs.value)
      succeededSlugs.forEach((s) => nextSelected.delete(s))
      selectedSlugs.value = nextSelected
    }
    // Summary toast — combine wins and losses into one message.
    if (failedReasons.length === 0) {
      toast.success(
        succeededSlugs.length === 1
          ? '1 producto eliminado.'
          : `${succeededSlugs.length} productos eliminados.`,
      )
    } else if (succeededSlugs.length === 0) {
      toast.error(`No se pudo eliminar: ${failedReasons.join('; ')}`)
    } else {
      toast.error(
        `${succeededSlugs.length} eliminado${succeededSlugs.length === 1 ? '' : 's'}. ` +
          `${failedReasons.length} con error: ${failedReasons.join('; ')}`,
      )
    }
  } finally {
    isBulkDeleting.value = false
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

    <!-- Bulk-action bar — shown only when at least one row is checked.
         Sticky-feel via top spacing; gives the staff a clear "you
         have N selected" affordance with a destructive primary CTA. -->
    <div
      v-if="selectedSlugs.size > 0 && status === 'success'"
      class="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3"
      data-testid="admin-bulk-action-bar"
    >
      <p class="text-sm font-medium text-text">
        {{ selectedSlugs.size }} seleccionado{{ selectedSlugs.size === 1 ? '' : 's' }}
      </p>
      <div class="flex items-center gap-2">
        <AppButton
          variant="ghost"
          size="sm"
          @click="clearSelection"
        >
          Limpiar
        </AppButton>
        <button
          type="button"
          class="rounded-md border border-error/40 bg-error/10 px-3 py-1.5 text-sm font-semibold text-error transition hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="isBulkDeleting"
          data-testid="admin-bulk-delete"
          @click="bulkDeleteSelected"
        >
          {{ isBulkDeleting ? 'Eliminando…' : 'Eliminar seleccionados' }}
        </button>
      </div>
    </div>

    <div
      v-if="status === 'success' && products.length > 0"
      class="overflow-hidden rounded-lg border border-border bg-surface-1"
      data-testid="admin-products-list"
    >
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-left uppercase tracking-wide text-text-muted">
          <tr>
            <th class="w-12 px-4 py-3">
              <input
                type="checkbox"
                aria-label="Seleccionar todos"
                :checked="allVisibleSelected"
                :indeterminate.prop="someVisibleSelected"
                data-testid="admin-bulk-select-all"
                class="size-4 cursor-pointer accent-primary"
                @change="toggleAll"
              >
            </th>
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
            :class="selectedSlugs.has(product.slug) && 'bg-primary/5'"
            :data-testid="`admin-product-row-${product.slug}`"
          >
            <td class="px-4 py-3">
              <input
                type="checkbox"
                :aria-label="`Seleccionar ${product.name}`"
                :checked="selectedSlugs.has(product.slug)"
                :data-testid="`admin-product-select-${product.slug}`"
                class="size-4 cursor-pointer accent-primary"
                @change="toggleRow(product.slug, ($event.target as HTMLInputElement).checked)"
              >
            </td>
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
