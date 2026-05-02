<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppStepper from '@/components/ui/AppStepper.vue'
import AppButton from '@/components/ui/AppButton.vue'
import MaterialCard from '@/components/order/MaterialCard.vue'
import SizePicker from '@/components/order/SizePicker.vue'
import QuantityStepper from '@/components/order/QuantityStepper.vue'
import OrderSummary from '@/components/order/OrderSummary.vue'
import { ordersService } from '@/services/orders.service'
import { useOrderStore } from '@/stores/order.store'
import { useToast } from '@/composables/useToast'
import {
  type Material,
  MATERIAL_LABELS,
  MIN_DIMENSION_MM,
  MIN_QUANTITY,
} from '@/types/order'

const route = useRoute()
const router = useRouter()
const orderStore = useOrderStore()
const toast = useToast()

const steps = [
  { number: 1, label: 'Subir diseño' },
  { number: 2, label: 'Editar' },
  { number: 3, label: 'Material y tamaño' },
  { number: 4, label: 'Resumen' },
]

const orderUuid = computed(() => route.params.uuid as string | undefined)

// === Form state ===
// Defaults are valid backend values so the live quote starts working
// immediately (no "click around to make the price appear" friction).
const material = ref<Material | ''>('')
const widthMm = ref<number>(70) // 7 cm — matches the mockup's default
const heightMm = ref<number>(70)
const quantity = ref<number>(100)
const withDesignService = ref<boolean>(false)
const withVarnish = ref<boolean>(false)
const withRelief = ref<boolean>(false)
const reliefNote = ref<string>('')

// === Quote state ===
const totalEur = ref<string>('')
const isQuoting = ref<boolean>(false)
const isSaving = ref<boolean>(false)

// === Order load (preserve existing values when revisiting) ===
const thumbnailUrl = ref<string | null>(null)

const ALL_MATERIALS = Object.keys(MATERIAL_LABELS) as Material[]

async function loadOrder() {
  if (!orderUuid.value) {
    toast.error('Pedido no encontrado. Volvé a empezar desde "Subir diseño".')
    router.push('/upload')
    return
  }
  try {
    const order = await ordersService.retrieve(orderUuid.value)
    orderStore.setCurrent(order)

    // Hydrate form from the existing order so revisiting preserves choices.
    if (order.material) material.value = order.material
    if (order.width_mm) widthMm.value = order.width_mm
    if (order.height_mm) heightMm.value = order.height_mm
    if (order.quantity && order.quantity >= MIN_QUANTITY) quantity.value = order.quantity
    withDesignService.value = order.with_design_service
    withVarnish.value = order.with_varnish
    withRelief.value = order.with_relief
    reliefNote.value = order.relief_note ?? ''

    // Use the uploaded original image as the preview thumbnail.
    const original = order.files.find((f) => f.kind === 'original')
    if (original) {
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
      with_design_service: withDesignService.value,
      with_varnish: withVarnish.value,
      with_relief: withRelief.value,
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
  [material, widthMm, heightMm, quantity, withDesignService, withVarnish, withRelief],
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
      width_mm: widthMm.value,
      height_mm: heightMm.value,
      quantity: quantity.value,
      with_design_service: withDesignService.value,
      with_varnish: withVarnish.value,
      with_relief: withRelief.value,
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
  // The editor (step 2) isn't built yet, so for now "Volver a editar" goes
  // back to the upload screen. When the editor lands, route to /editor/{uuid}.
  router.push('/upload')
}

onMounted(loadOrder)
</script>

<template>
  <section class="mx-auto max-w-7xl px-6 py-10">
    <AppStepper
      :steps="steps"
      :current="3"
      class="mb-10"
    />

    <div class="grid gap-8 lg:grid-cols-[1fr_360px]">
      <!-- LEFT: form -->
      <div class="flex flex-col gap-10">
        <!-- Material picker -->
        <section>
          <h2 class="mb-4 text-h3 font-bold text-text">
            Elegí el material
          </h2>
          <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MaterialCard
              v-for="m in ALL_MATERIALS"
              :key="m"
              :material="m"
              :selected="material === m"
              @select="material = m"
            />
          </div>
        </section>

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

        <!-- Add-ons -->
        <section>
          <h2 class="mb-4 text-h3 font-bold text-text">
            Acabados opcionales
          </h2>
          <div class="flex flex-col gap-3">
            <label class="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3 cursor-pointer">
              <input
                v-model="withDesignService"
                type="checkbox"
                class="size-4 accent-primary"
                data-testid="addon-design"
              >
              <div class="flex-1">
                <p class="text-sm font-semibold text-text">
                  Maquetación de archivos
                </p>
                <p class="text-xs text-text-muted">
                  Ajuste profesional de tu diseño antes de imprimir.
                </p>
              </div>
              <span class="text-sm text-text-muted">+€8,00</span>
            </label>
            <label class="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3 cursor-pointer">
              <input
                v-model="withVarnish"
                type="checkbox"
                class="size-4 accent-primary"
                data-testid="addon-varnish"
              >
              <div class="flex-1">
                <p class="text-sm font-semibold text-text">
                  Barniz
                </p>
                <p class="text-xs text-text-muted">
                  Capa protectora con acabado mate o brillante.
                </p>
              </div>
              <span class="text-sm text-text-muted">+€8,00</span>
            </label>
            <label class="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3 cursor-pointer">
              <input
                v-model="withRelief"
                type="checkbox"
                class="size-4 accent-primary"
                data-testid="addon-relief"
              >
              <div class="flex-1">
                <p class="text-sm font-semibold text-text">
                  Con relieve
                </p>
                <p class="text-xs text-text-muted">
                  Zonas elevadas en partes específicas del sticker.
                </p>
              </div>
              <span class="text-sm text-text-muted">+€12,00</span>
            </label>
            <textarea
              v-if="withRelief"
              v-model="reliefNote"
              placeholder="Describí dónde querés el relieve (p. ej. logo central, bordes…)"
              class="min-h-20 rounded-md border border-border bg-surface-2 p-3 text-sm text-text placeholder:text-text-muted focus-visible:border-primary focus-visible:outline-none"
              data-testid="relief-note"
            />
          </div>
        </section>

        <!-- Footer buttons -->
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
          :with-design-service="withDesignService"
          :with-varnish="withVarnish"
          :with-relief="withRelief"
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
