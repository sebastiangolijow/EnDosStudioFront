<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppStepper from '@/components/ui/AppStepper.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import OrderSummary from '@/components/order/OrderSummary.vue'
import CatalogOrderSummary from '@/components/catalog/CatalogOrderSummary.vue'
import ShippingForm from '@/components/order/ShippingForm.vue'
import { ordersService } from '@/services/orders.service'
import { useToast } from '@/composables/useToast'
import { type Order } from '@/types/order'

const route = useRoute()
const router = useRouter()
const toast = useToast()

// Stepper differs by kind. Catalog orders skip upload/editor/order-config —
// they go straight from /catalogo/:slug to /checkout/:uuid.
const STICKER_STEPS = [
  { number: 1, label: 'Subir diseño' },
  { number: 2, label: 'Editar' },
  { number: 3, label: 'Material y tamaño' },
  { number: 4, label: 'Resumen' },
]
const CATALOG_STEPS = [
  { number: 1, label: 'Catálogo' },
  { number: 2, label: 'Envío' },
  { number: 3, label: 'Pago' },
]

const orderUuid = computed(() => route.params.uuid as string | undefined)
const order = ref<Order | null>(null)
const isLoading = ref<boolean>(true)
const isProcessing = ref<boolean>(false)

const isCatalogOrder = computed<boolean>(() => order.value?.kind === 'catalog')
const stepper = computed(() => (isCatalogOrder.value ? CATALOG_STEPS : STICKER_STEPS))
const stepperCurrent = computed(() => (isCatalogOrder.value ? 2 : 4))

// === Shipping form state ===
const recipientName = ref<string>('')
const streetLine1 = ref<string>('')
const streetLine2 = ref<string>('')
const city = ref<string>('')
const postalCode = ref<string>('')
const country = ref<string>('ES')

// === Stripe handoff state ===
/**
 * After /place/ + /checkout/ succeed, we have the client_secret. The actual
 * Stripe Elements integration is gated on real keys (see CLAUDE.md "Stripe is
 * not live yet as of M2"). For now we surface a placeholder card showing the
 * pi_id so QA can confirm the round-trip worked end-to-end. When keys land,
 * mount <PaymentElement> here.
 */
const clientSecret = ref<string | null>(null)
const paymentIntentId = ref<string | null>(null)
const stripeError = ref<string | null>(null)

const thumbnailUrl = computed<string | null>(() => {
  if (!order.value) return null
  const original = order.value.files.find((f) => f.kind === 'original')
  return original?.file ?? null
})

/**
 * Display total. For catalog orders the backend's `total_amount_cents` is
 * 0 until place_order runs (i.e. the moment the customer hits Pagar), so
 * we derive it client-side from `product_detail.price_cents × product_quantity`
 * — same math the backend will compute. The backend remains the source of
 * truth at place_order time; this is purely a UI affordance for the
 * pre-payment summary so the customer doesn't see €0.00.
 */
const totalEur = computed<string>(() => {
  if (!order.value) return ''
  if (order.value.total_amount_cents > 0) {
    return order.value.total_eur
  }
  if (order.value.kind === 'catalog' && order.value.product_detail) {
    const cents = order.value.product_detail.price_cents * order.value.product_quantity
    return (cents / 100).toFixed(2)
  }
  return order.value.total_eur ?? ''
})

const formIsValid = computed<boolean>(
  () =>
    recipientName.value.trim().length > 0 &&
    streetLine1.value.trim().length > 0 &&
    city.value.trim().length > 0 &&
    postalCode.value.trim().length > 0 &&
    country.value.trim().length === 2,
)

async function loadOrder() {
  if (!orderUuid.value) {
    router.push('/dashboard')
    return
  }
  isLoading.value = true
  try {
    const fetched = await ordersService.retrieve(orderUuid.value)
    order.value = fetched

    // If shipping is already filled (revisit), hydrate the form
    if (fetched.recipient_name) recipientName.value = fetched.recipient_name
    if (fetched.street_line_1) streetLine1.value = fetched.street_line_1
    if (fetched.street_line_2) streetLine2.value = fetched.street_line_2
    if (fetched.city) city.value = fetched.city
    if (fetched.postal_code) postalCode.value = fetched.postal_code
    if (fetched.country) country.value = fetched.country

    // If the order is already past 'placed', send the customer to confirmation
    if (
      fetched.status === 'paid' ||
      fetched.status === 'in_production' ||
      fetched.status === 'shipped' ||
      fetched.status === 'delivered'
    ) {
      router.push({ name: 'confirmation', params: { uuid: fetched.uuid } })
      return
    }
  } catch {
    toast.error('No pudimos cargar tu pedido. Volvé al dashboard.')
    router.push('/dashboard')
  } finally {
    isLoading.value = false
  }
}

async function onPay() {
  if (!orderUuid.value || !formIsValid.value) {
    toast.warning('Completá todos los campos de envío.')
    return
  }
  isProcessing.value = true
  stripeError.value = null
  try {
    // PATCH + place are only allowed while the order is still a draft.
    // Customers revisiting a placed order (e.g. coming back to pay later)
    // skip straight to the Stripe step.
    if (order.value?.status === 'draft') {
      // 1. PATCH the shipping fields onto the order
      await ordersService.update(orderUuid.value, {
        recipient_name: recipientName.value,
        street_line_1: streetLine1.value,
        street_line_2: streetLine2.value,
        city: city.value,
        postal_code: postalCode.value,
        country: country.value.toUpperCase(),
      })

      // 2. Transition draft → placed (validates required fields server-side,
      //    computes the total).
      const placed = await ordersService.place(orderUuid.value)
      order.value = placed
    }

    // 3. Create the Stripe PaymentIntent. Returns 502 if the backend lacks
    //    real Stripe keys — handle gracefully. Returns 409 with
    //    detail=insufficient_stock for catalog orders if stock dropped.
    const checkout = await ordersService.checkout(orderUuid.value)
    clientSecret.value = checkout.client_secret
    paymentIntentId.value = checkout.payment_intent_id

    // 4. TODO: mount <PaymentElement> with `options: { clientSecret }` here.
    //    For now the placeholder card below shows the customer the next-step
    //    state so the test harness has something to assert on.
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    const data = (e as { response?: { data?: { detail?: string; message?: string } } }).response?.data
    const detail = data?.detail
    if (status === 502) {
      stripeError.value =
        'El procesador de pagos aún no está configurado en este entorno. Vuelve más tarde.'
    } else if (status === 409 && detail === 'insufficient_stock') {
      // Catalog: stock dropped under us between place and checkout.
      const message =
        data?.message ?? 'Este producto se quedó sin stock antes de pagar.'
      toast.error(message)
      // Send the customer back to the product page (or catalog if we lack slug)
      if (order.value?.product_detail?.slug) {
        router.push({
          name: 'catalog-detail',
          params: { slug: order.value.product_detail.slug },
        })
      } else {
        router.push('/catalogo')
      }
      return
    } else if (status === 409) {
      stripeError.value =
        detail ?? 'Tu pedido no está en un estado válido para el pago. Volvé al dashboard.'
    } else {
      stripeError.value = detail ?? 'No pudimos procesar el pago. Intentá de nuevo.'
    }
  } finally {
    isProcessing.value = false
  }
}

function onBack() {
  if (isCatalogOrder.value) {
    // Catalog: back to the product detail (or catalog if no slug nested).
    if (order.value?.product_detail?.slug) {
      router.push({
        name: 'catalog-detail',
        params: { slug: order.value.product_detail.slug },
      })
    } else {
      router.push('/catalogo')
    }
    return
  }
  if (orderUuid.value) {
    router.push({ name: 'order-config', params: { uuid: orderUuid.value } })
  } else {
    router.push('/dashboard')
  }
}

onMounted(loadOrder)
</script>

<template>
  <section class="mx-auto max-w-7xl px-6 py-10">
    <AppStepper
      :steps="stepper"
      :current="stepperCurrent"
      class="mb-10"
    />

    <div
      v-if="isLoading"
      class="rounded-lg border border-border bg-surface-2 p-12 text-center text-text-muted"
    >
      Cargando pedido...
    </div>

    <div
      v-else-if="order"
      class="grid gap-8 lg:grid-cols-[1fr_360px]"
    >
      <!-- LEFT: shipping form OR Stripe handoff -->
      <div class="flex flex-col gap-8">
        <!-- Shipping form: visible until checkout succeeds -->
        <ShippingForm
          v-if="!clientSecret"
          :recipient-name="recipientName"
          :street-line1="streetLine1"
          :street-line2="streetLine2"
          :city="city"
          :postal-code="postalCode"
          :country="country"
          @update:recipient-name="recipientName = $event"
          @update:street-line1="streetLine1 = $event"
          @update:street-line2="streetLine2 = $event"
          @update:city="city = $event"
          @update:postal-code="postalCode = $event"
          @update:country="country = $event"
        />

        <!-- Stripe Elements placeholder. Replaced by <PaymentElement> when
             the checkout endpoint returns a real client_secret + we have
             a Stripe.js publishable key in the env. -->
        <AppCard
          v-if="clientSecret"
          data-testid="checkout-stripe-placeholder"
        >
          <h2 class="text-h3 font-bold text-text">
            Casi listo
          </h2>
          <p class="mt-2 text-sm text-text-muted">
            Tu pedido está reservado. Stripe te pedirá los datos de la tarjeta a continuación.
          </p>
          <dl class="mt-4 flex flex-col gap-2 text-xs">
            <div class="flex justify-between gap-3 text-text-muted">
              <dt>PaymentIntent</dt>
              <dd class="font-mono">
                {{ paymentIntentId }}
              </dd>
            </div>
          </dl>
          <p class="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            ⚠️ Stripe Elements no está montado todavía. Cuando el shop owner
            configure las claves reales de Stripe, este bloque se reemplaza por
            el formulario de tarjeta. Por ahora el pedido queda en estado
            "Realizado" en tu dashboard.
          </p>
        </AppCard>

        <!-- Error feedback -->
        <p
          v-if="stripeError"
          class="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error"
          role="alert"
          data-testid="checkout-error"
        >
          {{ stripeError }}
        </p>

        <!-- Footer buttons -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <AppButton
            variant="ghost"
            :disabled="isProcessing"
            @click="onBack"
          >
            ← Volver
          </AppButton>
          <AppButton
            v-if="!clientSecret"
            size="lg"
            :loading="isProcessing"
            :disabled="!formIsValid"
            data-testid="checkout-pay"
            @click="onPay"
          >
            Confirmar y pagar 🔒
          </AppButton>
          <AppButton
            v-else
            size="lg"
            data-testid="checkout-go-dashboard"
            @click="router.push('/dashboard')"
          >
            Ir al dashboard
          </AppButton>
        </div>
      </div>

      <!-- RIGHT: read-only summary (kind-aware) -->
      <div class="lg:sticky lg:top-24 lg:self-start">
        <CatalogOrderSummary
          v-if="isCatalogOrder"
          :product="order.product_detail"
          :product-quantity="order.product_quantity"
          :total-eur="totalEur"
          :cta-loading="false"
          :hide-cta="true"
          @continue="onPay"
        />
        <OrderSummary
          v-else
          :material="order.material"
          :width-mm="order.width_mm"
          :height-mm="order.height_mm"
          :quantity="order.quantity"
          :with-relief="order.with_relief"
          :with-tinta-blanca="order.with_tinta_blanca"
          :with-barniz-brillo="order.with_barniz_brillo"
          :with-barniz-opaco="order.with_barniz_opaco"
          :total-eur="totalEur"
          :thumbnail-url="thumbnailUrl"
          :cta-loading="false"
          @continue="onPay"
        />
      </div>
    </div>
  </section>
</template>
