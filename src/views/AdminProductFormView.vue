<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { productsService } from '@/services/products.service'
import { useToast } from '@/composables/useToast'
import type { Product } from '@/types/product'
import type { AsyncStatus } from '@/types/api'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const slugParam = computed(() => route.params.slug as string | undefined)
const isEditMode = computed(() => !!slugParam.value)

// Form fields
const name = ref<string>('')
const description = ref<string>('')
// Prices are in € on the form, sent as cents on the wire.
const priceEur = ref<string>('')
const stockQuantity = ref<string>('0')
const isActive = ref<boolean>(true)
const imageFile = ref<File | null>(null)
const imagePreview = ref<string | null>(null) // either an object URL (new file) or the existing remote URL

const loadStatus = ref<AsyncStatus>('idle')
const saveStatus = ref<AsyncStatus>('idle')

const formIsValid = computed<boolean>(() => {
  if (!name.value.trim()) return false
  const price = Number(priceEur.value)
  if (Number.isNaN(price) || price < 0) return false
  const stock = Number(stockQuantity.value)
  if (!Number.isInteger(stock) || stock < 0) return false
  return true
})

function hydrate(product: Product) {
  name.value = product.name
  description.value = product.description
  priceEur.value = (product.price_cents / 100).toFixed(2)
  stockQuantity.value = String(product.stock_quantity)
  isActive.value = product.is_active
  imagePreview.value = product.image // remote URL, may be null
}

async function loadForEdit() {
  if (!slugParam.value) return
  loadStatus.value = 'loading'
  try {
    const product = await productsService.getBySlug(slugParam.value)
    hydrate(product)
    loadStatus.value = 'success'
  } catch {
    loadStatus.value = 'error'
    toast.error('No pudimos cargar el producto.')
    router.push({ name: 'admin-products' })
  }
}

function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  imageFile.value = file
  if (file) {
    // Revoke any previous object URL we created
    if (imagePreview.value && imagePreview.value.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview.value)
    }
    imagePreview.value = URL.createObjectURL(file)
  }
}

async function onSave() {
  if (!formIsValid.value) {
    toast.warning('Completá todos los campos antes de guardar.')
    return
  }
  saveStatus.value = 'loading'
  const cents = Math.round(Number(priceEur.value) * 100)
  const stock = Number(stockQuantity.value)

  try {
    if (isEditMode.value && slugParam.value) {
      await productsService.adminUpdate(slugParam.value, {
        name: name.value.trim(),
        description: description.value.trim(),
        price_cents: cents,
        stock_quantity: stock,
        is_active: isActive.value,
        image: imageFile.value ?? undefined, // omit when not picked, so existing image is preserved
      })
      toast.info('Producto actualizado.')
    } else {
      await productsService.adminCreate({
        name: name.value.trim(),
        description: description.value.trim(),
        price_cents: cents,
        stock_quantity: stock,
        is_active: isActive.value,
        image: imageFile.value,
      })
      toast.info('Producto creado.')
    }
    saveStatus.value = 'success'
    router.push({ name: 'admin-products' })
  } catch {
    saveStatus.value = 'error'
    toast.error('No pudimos guardar el producto. Revisá los datos.')
  }
}

onMounted(() => {
  if (isEditMode.value) loadForEdit()
})
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12">
    <RouterLink
      :to="{ name: 'admin-products' }"
      class="mb-6 inline-block text-sm text-text-muted hover:text-text"
    >
      ← Volver a productos
    </RouterLink>

    <h1 class="mb-8 text-h1 font-bold uppercase tracking-tight text-text">
      {{ isEditMode ? 'Editar producto' : 'Nuevo producto' }}
    </h1>

    <div
      v-if="isEditMode && loadStatus === 'loading'"
      class="py-12 text-center text-text-muted"
    >
      Cargando…
    </div>

    <form
      v-else
      class="flex flex-col gap-6"
      data-testid="admin-product-form"
      @submit.prevent="onSave"
    >
      <!-- Image picker + preview -->
      <div>
        <label class="mb-1 block text-sm font-medium text-text">
          Imagen
        </label>
        <div class="flex items-start gap-4">
          <div class="size-32 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2">
            <img
              v-if="imagePreview"
              :src="imagePreview"
              alt="Vista previa del producto"
              class="size-full object-cover"
            >
            <div
              v-else
              class="size-full bg-holographic opacity-30"
              aria-hidden="true"
            />
          </div>
          <div class="flex flex-col gap-2">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              data-testid="admin-product-image"
              class="block text-sm text-text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-1 file:px-3 file:py-1 file:text-sm file:text-text hover:file:bg-surface-2"
              @change="onImagePicked"
            >
            <p class="text-xs text-text-muted">
              PNG / JPG / WEBP. Cuadrada idealmente.
            </p>
          </div>
        </div>
      </div>

      <AppInput
        v-model="name"
        label="Nombre"
        placeholder="Llavero rojo"
        required
        data-testid="admin-product-name"
      />

      <label class="block">
        <span class="mb-1 block text-sm font-medium text-text">Descripción</span>
        <textarea
          v-model="description"
          rows="4"
          class="w-full rounded-sm border border-border bg-surface-1 p-3 text-base text-text placeholder:text-text-muted focus-visible:border-primary focus-visible:outline-none"
          placeholder="Acrílico transparente, 5 cm…"
          data-testid="admin-product-description"
        />
      </label>

      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput
          v-model="priceEur"
          label="Precio (€)"
          type="number"
          required
          placeholder="15.00"
          data-testid="admin-product-price-eur"
        />
        <AppInput
          v-model="stockQuantity"
          label="Stock"
          type="number"
          required
          placeholder="10"
          data-testid="admin-product-stock"
        />
      </div>

      <label class="flex items-center gap-3">
        <input
          v-model="isActive"
          type="checkbox"
          class="size-4 accent-primary"
          data-testid="admin-product-active"
        >
        <span class="text-sm text-text">Visible en el catálogo público</span>
      </label>

      <div class="flex flex-wrap gap-3 border-t border-border pt-6">
        <AppButton
          variant="ghost"
          type="button"
          @click="router.push({ name: 'admin-products' })"
        >
          Cancelar
        </AppButton>
        <AppButton
          size="lg"
          type="submit"
          :disabled="!formIsValid"
          :loading="saveStatus === 'loading'"
          data-testid="admin-product-submit"
        >
          {{ isEditMode ? 'Guardar cambios' : 'Crear producto' }}
        </AppButton>
      </div>
    </form>
  </section>
</template>
