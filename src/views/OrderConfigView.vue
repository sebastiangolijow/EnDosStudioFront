<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppStepper from '@/components/ui/AppStepper.vue'
import AppButton from '@/components/ui/AppButton.vue'
import SizePicker from '@/components/order/SizePicker.vue'
import QuantityStepper from '@/components/order/QuantityStepper.vue'
import OrderSummary from '@/components/order/OrderSummary.vue'
import { ordersService } from '@/services/orders.service'
import { useOrderStore } from '@/stores/order.store'
import { useToast } from '@/composables/useToast'
import {
  type Material,
  MIN_DIMENSION_MM,
  MIN_QUANTITY,
  type Shape,
} from '@/types/order'

const route = useRoute()
const router = useRouter()
const orderStore = useOrderStore()
const toast = useToast()

const steps = [
  { number: 1, label: 'Diseñar' },
  { number: 2, label: 'Material y tamaño' },
  { number: 3, label: 'Resumen' },
]

const orderUuid = computed(() => route.params.uuid as string | undefined)

// === Form state ===
// Defaults are valid backend values so the live quote starts working
// immediately (no "click around to make the price appear" friction).
const material = ref<Material | ''>('')
// Default `contorneado` matches the backend default and the existing
// auto-cut flow. Customer can switch to a primitive shape and skip the
// editor entirely.
const shape = ref<Shape>('contorneado')
const widthMm = ref<number>(70) // 7 cm — matches the mockup's default
const heightMm = ref<number>(70)
const quantity = ref<number>(100)
const reliefNote = ref<string>('')
const withTintaBlanca = ref<boolean>(false)

// "Acabado" — single mutually-exclusive choice across relieve and barniz.
// The backend stores them as three independent booleans
// (with_relief, with_barniz_brillo, with_barniz_opaco). The UI collapses
// to one radio because physically a sticker can have ONE finish:
// embossing OR gloss laminate OR matte laminate. The PATCH always sends
// the three booleans together so server-side state matches the UI's
// mutual-exclusion invariant.
type Acabado = 'none' | 'relieve' | 'brillo' | 'opaco'
const acabado = ref<Acabado>('none')
const withRelief = computed(() => acabado.value === 'relieve')
const withBarnizBrillo = computed(() => acabado.value === 'brillo')
const withBarnizOpaco = computed(() => acabado.value === 'opaco')

// === Quote state ===
const totalEur = ref<string>('')
const isQuoting = ref<boolean>(false)
const isSaving = ref<boolean>(false)

// === Order load (preserve existing values when revisiting) ===
const thumbnailUrl = ref<string | null>(null)

async function loadOrder() {
  if (!orderUuid.value) {
    toast.error('Pedido no encontrado. Volvé al dashboard para empezar otro.')
    router.push('/dashboard')
    return
  }
  try {
    const order = await ordersService.retrieve(orderUuid.value)
    orderStore.setCurrent(order)

    // Hydrate form from the existing order so revisiting preserves choices.
    // Material + shape come from the editor (step 1) — read but don't render.
    if (order.material) material.value = order.material
    if (order.shape) shape.value = order.shape
    if (order.width_mm) widthMm.value = order.width_mm
    if (order.height_mm) heightMm.value = order.height_mm
    if (order.quantity && order.quantity >= MIN_QUANTITY) quantity.value = order.quantity
    withTintaBlanca.value = order.with_tinta_blanca
    reliefNote.value = order.relief_note ?? ''
    // Collapse the three booleans into the single `acabado` radio value.
    // If a legacy order somehow has relief + barniz both set, relief wins
    // (it's the more dramatic finish; corresponds to the bigger surcharge).
    if (order.with_relief) acabado.value = 'relieve'
    else if (order.with_barniz_brillo) acabado.value = 'brillo'
    else if (order.with_barniz_opaco) acabado.value = 'opaco'
    else acabado.value = 'none'

    // Prefer the editor's composite snapshot (what the customer
    // actually designed — artwork + halo + FX) over the raw original
    // upload. Falls back to original / local URL when no composite
    // was uploaded (e.g. a customer who skipped the editor or hit
    // Continuar before the snapshot landed). This is what makes the
    // summary card on /order-config and /checkout show the cut+
    // material-tinted version instead of the bare uploaded PNG.
    const composite = order.files.find((f) => f.kind === 'preview_composite')
    const original = order.files.find((f) => f.kind === 'original')
    if (composite) {
      thumbnailUrl.value = composite.file
    } else if (original) {
      thumbnailUrl.value = original.file
    } else if (orderStore.localOriginalUrl) {
      thumbnailUrl.value = orderStore.localOriginalUrl
    }
  } catch {
    toast.error('No pudimos cargar tu pedido. Intentá de nuevo.')
    router.push('/dashboard')
  }
}

// === Debounced quote ===
let quoteTimer: ReturnType<typeof setTimeout> | null = null

function scheduleQuote() {
  if (quoteTimer) clearTimeout(quoteTimer)
  quoteTimer = setTimeout(fetchQuote, 250)
}

async function fetchQuote() {
  if (!material.value) return
  if (
    widthMm.value < MIN_DIMENSION_MM ||
    heightMm.value < MIN_DIMENSION_MM ||
    widthMm.value % 5 !== 0 ||
    heightMm.value % 5 !== 0 ||
    quantity.value < MIN_QUANTITY
  ) {
    return
  }

  isQuoting.value = true
  try {
    const quote = await ordersService.quote({
      material: material.value,
      width_mm: widthMm.value,
      height_mm: heightMm.value,
      quantity: quantity.value,
      with_relief: withRelief.value,
      with_tinta_blanca: withTintaBlanca.value,
      with_barniz_brillo: withBarnizBrillo.value,
      with_barniz_opaco: withBarnizOpaco.value,
    })
    totalEur.value = quote.total_eur
  } catch {
    // Keep the previous total visible — better than flickering "—".
    // The summary's "Calculando…" will only show if this is the first quote.
  } finally {
    isQuoting.value = false
  }
}

// Re-quote whenever any pricing input changes
watch(
  [
    material,
    widthMm,
    heightMm,
    quantity,
    acabado,
    withTintaBlanca,
  ],
  () => {
    scheduleQuote()
  },
)

// === Continue ===
async function onContinue() {
  if (!orderUuid.value) return
  if (!material.value) {
    toast.warning('Elegí un material para continuar.')
    return
  }
  isSaving.value = true
  try {
    await ordersService.update(orderUuid.value, {
      material: material.value,
      shape: shape.value,
      width_mm: widthMm.value,
      height_mm: heightMm.value,
      quantity: quantity.value,
      with_relief: withRelief.value,
      with_tinta_blanca: withTintaBlanca.value,
      with_barniz_brillo: withBarnizBrillo.value,
      with_barniz_opaco: withBarnizOpaco.value,
      relief_note: reliefNote.value,
    })
    router.push({ name: 'checkout', params: { uuid: orderUuid.value } })
  } catch (e) {
    const detail =
      (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
      'No pudimos guardar tu pedido. Intentá de nuevo.'
    toast.error(detail)
  } finally {
    isSaving.value = false
  }
}

function onBack() {
  // Every shape passes through the editor for margin adjustment, so
  // "Volver a editar" always returns to /editor.
  if (orderUuid.value) {
    router.push({ name: 'editor', params: { uuid: orderUuid.value } })
  } else {
    router.push('/dashboard')
  }
}

onMounted(loadOrder)
</script>

<template>
  <section class="px-8 py-10 md:px-12 lg:px-16">
    <AppStepper
      :steps="steps"
      :current="2"
      class="mb-6 md:mb-10"
    />

    <!-- Mobile-only back link. The "Volver a editar" button at the
         bottom of the form is hard to find on mobile (long scroll
         past materials + size + quantity + add-ons). Desktop has its
         own "Volver al editor" affordance inside the material section. -->
    <AppButton
      variant="ghost"
      size="sm"
      class="mb-4 lg:hidden"
      @click="onBack"
    >
      ← Volver al editor
    </AppButton>

    <div class="grid gap-8 lg:grid-cols-[1fr_360px]">
      <!-- LEFT: form. Material + shape no longer rendered — both are
           already chosen in the editor (step 1) and persisted on the
           order. We just hydrate them on load and pass through on the
           PATCH. -->
      <div class="flex flex-col gap-10">
        <!-- Inner 2-column grid on lg+: size + cantidad on the left,
             acabados on the right. Stops the acabados radios from
             running edge-to-edge across the whole form (they read as
             too wide / too sparse otherwise). Mobile stays single-column. -->
        <div class="grid gap-10 lg:grid-cols-2 lg:items-start">
        <!-- Left column: size + cantidad -->
        <div class="flex flex-col gap-10">
          <!-- Size picker -->
          <section>
            <h2 class="mb-4 text-h3 font-bold text-text">
              Elegí el tamaño
            </h2>
            <SizePicker
              :width-mm="widthMm"
              :height-mm="heightMm"
              @update:width-mm="widthMm = $event"
              @update:height-mm="heightMm = $event"
            />
          </section>

          <!-- Quantity -->
          <section>
            <h2 class="mb-4 text-h3 font-bold text-text">
              Cantidad
            </h2>
            <QuantityStepper v-model="quantity" />
          </section>
        </div>

        <!-- Right column: acabados opcionales — single mutually-exclusive radio group.
             Relieve and barniz can't coexist on a physical sticker, so
             the UI enforces it. Tinta blanca is independent (it's a
             printing technique, not a finish — applies to any acabado). -->
        <section>
          <h2 class="mb-4 text-h3 font-bold text-text">
            Acabados opcionales
          </h2>
          <div class="flex flex-col gap-3">
            <fieldset class="flex flex-col gap-2">
              <legend class="sr-only">Acabado</legend>
              <label class="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
                <input
                  v-model="acabado"
                  type="radio"
                  value="none"
                  class="size-4 accent-primary"
                  data-testid="acabado-none"
                >
                <div class="flex-1">
                  <p class="text-sm font-semibold text-text">
                    Sin acabado
                  </p>
                  <p class="text-xs text-text-muted">
                    Acabado mate estándar.
                  </p>
                </div>
              </label>
              <label class="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
                <input
                  v-model="acabado"
                  type="radio"
                  value="relieve"
                  class="size-4 accent-primary"
                  data-testid="acabado-relieve"
                >
                <div class="flex-1">
                  <p class="text-sm font-semibold text-text">
                    Con relieve
                  </p>
                  <p class="text-xs text-text-muted">
                    Zonas elevadas en partes específicas del sticker.
                  </p>
                </div>
                <span class="text-sm text-text-muted">+35%</span>
              </label>
              <!-- Relief-note input opens only when relieve is selected. -->
              <textarea
                v-if="acabado === 'relieve'"
                v-model="reliefNote"
                placeholder="Describí dónde querés el relieve (p. ej. logo central, bordes…)"
                class="min-h-20 rounded-md border border-border bg-surface-2 p-3 text-sm text-text placeholder:text-text-muted focus-visible:border-primary focus-visible:outline-none"
                data-testid="relief-note"
              />
              <label class="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
                <input
                  v-model="acabado"
                  type="radio"
                  value="brillo"
                  class="size-4 accent-primary"
                  data-testid="acabado-brillo"
                >
                <div class="flex-1">
                  <p class="text-sm font-semibold text-text">
                    Barniz brillo
                  </p>
                  <p class="text-xs text-text-muted">
                    Capa protectora con acabado brillante.
                  </p>
                </div>
                <span class="text-sm text-text-muted">+20%</span>
              </label>
              <label class="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
                <input
                  v-model="acabado"
                  type="radio"
                  value="opaco"
                  class="size-4 accent-primary"
                  data-testid="acabado-opaco"
                >
                <div class="flex-1">
                  <p class="text-sm font-semibold text-text">
                    Barniz opaco
                  </p>
                  <p class="text-xs text-text-muted">
                    Capa protectora con acabado mate.
                  </p>
                </div>
                <span class="text-sm text-text-muted">+20%</span>
              </label>
            </fieldset>

            <!-- Tinta blanca — independent of acabado. -->
            <label class="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
              <input
                v-model="withTintaBlanca"
                type="checkbox"
                class="size-4 accent-primary"
                data-testid="addon-tinta-blanca"
              >
              <div class="flex-1">
                <p class="text-sm font-semibold text-text">
                  Tinta blanca
                </p>
                <p class="text-xs text-text-muted">
                  Para colores opacos sobre vinilos transparentes u oscuros.
                </p>
              </div>
              <span class="text-sm text-text-muted">+35%</span>
            </label>
          </div>
        </section>
        </div>
        <!-- /inner 2-col grid -->

        <!-- Footer buttons — flow under the inner grid, full form-column width. -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <AppButton
            variant="ghost"
            @click="onBack"
          >
            ← Volver a editar
          </AppButton>
        </div>
      </div>

      <!-- RIGHT: summary (sticky) -->
      <div class="lg:sticky lg:top-24 lg:self-start">
        <OrderSummary
          :material="material"
          :width-mm="widthMm"
          :height-mm="heightMm"
          :quantity="quantity"
          :with-relief="withRelief"
          :with-tinta-blanca="withTintaBlanca"
          :with-barniz-brillo="withBarnizBrillo"
          :with-barniz-opaco="withBarnizOpaco"
          :total-eur="totalEur"
          :thumbnail-url="thumbnailUrl"
          :is-quoting="isQuoting"
          :cta-loading="isSaving"
          @continue="onContinue"
        />
      </div>
    </div>
  </section>
</template>
