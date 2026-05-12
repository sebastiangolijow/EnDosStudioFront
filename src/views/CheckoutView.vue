<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppStepper from '@/components/ui/AppStepper.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppModal from '@/components/ui/AppModal.vue'
import OrderSummary from '@/components/order/OrderSummary.vue'
import CatalogOrderSummary from '@/components/catalog/CatalogOrderSummary.vue'
import ShippingForm from '@/components/order/ShippingForm.vue'
import { ordersService } from '@/services/orders.service'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth.store'
import {
  type Order,
  type ShippingMethod,
  SHIPPING_METHOD_ETA,
  SHIPPING_METHOD_LABELS,
  SHIPPING_METHOD_SURCHARGE_LABEL,
} from '@/types/order'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const authStore = useAuthStore()

// Stepper differs by kind. Catalog orders skip the editor + order-config —
// they go straight from /catalogo/:slug to /checkout/:uuid.
const STICKER_STEPS = [
  { number: 1, label: 'Diseñar' },
  { number: 2, label: 'Material y tamaño' },
  { number: 3, label: 'Resumen' },
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

/**
 * Live quote for sticker orders. The backend's `total_amount_cents` is
 * only populated after `place_order` runs (which happens when the
 * customer hits "Confirmar y pagar"). Before that the order shows 0,
 * so the pre-payment summary would say €0.00 — the customer panics.
 *
 * Fix: as soon as the order loads, hit `/orders/quote/` (the pure-
 * function pricing endpoint that doesn't touch the DB) with the
 * order's specs to get a live total. Same authoritative formula the
 * backend will use at place_order time. Catalog orders skip this and
 * use product_detail.price_cents × product_quantity (see totalEur).
 */
const quotedTotalEur = ref<string>('')
const quotedSubtotalEur = ref<string>('')
const quotedIvaEur = ref<string>('')

const isCatalogOrder = computed<boolean>(() => order.value?.kind === 'catalog')
const stepper = computed(() => (isCatalogOrder.value ? CATALOG_STEPS : STICKER_STEPS))
// Sticker stepper has 3 steps now (was 4); Resumen is step 3.
const stepperCurrent = computed(() => (isCatalogOrder.value ? 2 : 3))

// === Shipping form state ===
const recipientName = ref<string>('')
const streetLine1 = ref<string>('')
const streetLine2 = ref<string>('')
const city = ref<string>('')
const postalCode = ref<string>('')
const country = ref<string>('ES')
// Contact for the courier. shipping_phone is required at place_order;
// shipping_email is optional. Both pre-filled from auth.user where
// possible (see hydrate logic in loadOrder).
const shippingPhone = ref<string>('')
const shippingEmail = ref<string>('')
// Shipping speed — drives a multiplicative surcharge on the total
// (express +20%, flash +60%, normal +0%). Default 'normal' matches
// the backend default. Customer change → live re-quote + PATCH.
const shippingMethod = ref<ShippingMethod>('normal')
// UI-only static lists for the radio group (labels + ETAs + surcharges
// come from the type module's labelled constants so they stay in sync
// with the backend's choices).
const SHIPPING_OPTIONS: ShippingMethod[] = ['normal', 'express', 'flash']

// === Stripe handoff state ===
/**
 * After /place/ + /checkout/ succeed, we have the client_secret. The actual
 * Stripe Elements integration is gated on real keys (see CLAUDE.md "Stripe is
 * not live yet as of M2"). For now we surface a placeholder card showing the
 * pi_id so QA can confirm the round-trip worked end-to-end. When keys land,
 * mount <PaymentElement> here.
 */
const clientSecret = ref<string | null>(null)

// === Reservation state ===
// Whitelisted customers see a "Reservar y pagar en tienda" CTA.
// Picking it opens a modal that collects pickup date+time; submit calls
// POST /orders/{uuid}/reserve/ which marks the order 'reserved' instead
// of running through Stripe. Owner takes cash at pickup.
const reserveModalOpen = ref<boolean>(false)
const isReserving = ref<boolean>(false)
// Default: 2 days out at 11:00. Far enough that customers don't accidentally
// pick a same-day slot; early enough that they don't have to scroll a calendar.
function defaultPickupDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}
const pickupDate = ref<string>(defaultPickupDate())
const pickupTime = ref<string>('11:00')

const canReserve = computed<boolean>(() => !!authStore.user?.can_reserve_orders)
const paymentIntentId = ref<string | null>(null)
const stripeError = ref<string | null>(null)

const thumbnailUrl = computed<string | null>(() => {
  if (!order.value) return null
  // Prefer the editor's composite snapshot (artwork + halo + FX as
  // the customer saw it) over the raw original upload. Falls back
  // to original if the composite wasn't uploaded (early flows, or
  // catalog orders which never run through the editor).
  const composite = order.value.files.find((f) => f.kind === 'preview_composite')
  if (composite) return composite.file
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
    // Catalog pre-place: effective_price_cents = sale price when set,
    // else regular (matches backend _compute_catalog_total_cents).
    // All-in = pre-IVA × 1.21.
    const cents = Math.round(
      order.value.product_detail.effective_price_cents
        * order.value.product_quantity
        * 1.21,
    )
    return (cents / 100).toFixed(2)
  }
  // Sticker order, pre-place_order: use the live quote we fetched in
  // loadOrder. Empty string while the quote is in flight — OrderSummary
  // shows the CTA as disabled in that state via the `!totalEur` check.
  return quotedTotalEur.value || order.value.total_eur || ''
})

/**
 * Pre-IVA subtotal for the summary card. Prefers (1) the order's stored
 * breakdown once it's been placed, (2) the live quote response, (3) a
 * client-side derivation from total / 1.21 for catalog pre-place. Spanish
 * B2C convention surfaces this as its own line.
 */
const subtotalEur = computed<string>(() => {
  if (!order.value) return ''
  if (order.value.subtotal_cents > 0) return order.value.subtotal_eur
  if (quotedSubtotalEur.value) return quotedSubtotalEur.value
  if (order.value.kind === 'catalog' && order.value.product_detail) {
    const cents
      = order.value.product_detail.effective_price_cents * order.value.product_quantity
    return (cents / 100).toFixed(2)
  }
  return ''
})

const ivaEur = computed<string>(() => {
  if (!order.value) return ''
  if (order.value.iva_cents > 0) return order.value.iva_eur
  if (quotedIvaEur.value) return quotedIvaEur.value
  if (order.value.kind === 'catalog' && order.value.product_detail) {
    const subCents
      = order.value.product_detail.effective_price_cents * order.value.product_quantity
    const ivaCents = Math.round(subCents * 0.21)
    return (ivaCents / 100).toFixed(2)
  }
  return ''
})

const formIsValid = computed<boolean>(
  () =>
    recipientName.value.trim().length > 0 &&
    streetLine1.value.trim().length > 0 &&
    city.value.trim().length > 0 &&
    postalCode.value.trim().length > 0 &&
    country.value.trim().length === 2 &&
    shippingPhone.value.trim().length > 0,
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

    // Fire the live quote for sticker orders that haven't been placed
    // yet. Catalog orders compute the line total client-side from
    // product_detail; nothing to fetch.
    if (
      fetched.kind === 'sticker' &&
      fetched.total_amount_cents === 0 &&
      fetched.material &&
      fetched.width_mm &&
      fetched.height_mm &&
      fetched.quantity
    ) {
      // Don't await — the summary card just shows '—' until the quote
      // resolves; blocking the whole loadOrder on this would feel laggy.
      // Failures fall back to the order's stored total (still 0, but the
      // summary already handles that gracefully via the empty-string
      // disabled-CTA path).
      ordersService
        .quote({
          material: fetched.material,
          width_mm: fetched.width_mm,
          height_mm: fetched.height_mm,
          quantity: fetched.quantity,
          with_relief: fetched.with_relief,
          with_tinta_blanca: fetched.with_tinta_blanca,
          with_barniz_brillo: fetched.with_barniz_brillo,
          with_barniz_opaco: fetched.with_barniz_opaco,
          shipping_method: fetched.shipping_method,
        })
        .then((q) => {
          quotedTotalEur.value = q.total_eur
          quotedSubtotalEur.value = q.subtotal_eur
          quotedIvaEur.value = q.iva_eur
        })
        .catch(() => {
          // Silent: the summary will keep showing the order's stored
          // total. Not worth a toast — the customer can still hit
          // Confirmar y pagar; place_order will compute the real total
          // on the backend.
        })
    }

    // If shipping is already filled (revisit), hydrate the form
    if (fetched.recipient_name) recipientName.value = fetched.recipient_name
    if (fetched.street_line_1) streetLine1.value = fetched.street_line_1
    if (fetched.street_line_2) streetLine2.value = fetched.street_line_2
    if (fetched.city) city.value = fetched.city
    if (fetched.postal_code) postalCode.value = fetched.postal_code
    if (fetched.country) country.value = fetched.country
    if (fetched.shipping_method) shippingMethod.value = fetched.shipping_method
    // Contact fields — order takes precedence (revisit), then fall back
    // to the user's account values for first-time fill.
    shippingPhone.value = fetched.shipping_phone || authStore.user?.phone_number || ''
    shippingEmail.value = fetched.shipping_email || authStore.user?.email || ''

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
        shipping_phone: shippingPhone.value,
        shipping_email: shippingEmail.value,
        shipping_method: shippingMethod.value,
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

/**
 * Reserve flow — alternative to Stripe for whitelisted customers.
 * Same shipping-fields gating as onPay (we still want a phone in case
 * the owner needs to coordinate pickup), then PATCH shipping → POST
 * /reserve/ → redirect to /confirmation. Cash changes hands at pickup.
 */
function openReserveModal() {
  if (!formIsValid.value) {
    toast.warning('Completá los datos de contacto antes de reservar.')
    return
  }
  reserveModalOpen.value = true
}

async function onReserve() {
  if (!orderUuid.value || !formIsValid.value) {
    toast.warning('Completá todos los campos.')
    return
  }
  if (!pickupDate.value || !pickupTime.value) {
    toast.warning('Elegí fecha y hora para retirar el pedido.')
    return
  }
  // Combine date + time inputs into an ISO datetime. Treated as local
  // time on the client — the backend converts to UTC. Construct via
  // Date() so the customer's tz offset is baked in.
  const local = new Date(`${pickupDate.value}T${pickupTime.value}`)
  if (Number.isNaN(local.getTime())) {
    toast.warning('Fecha u hora inválida.')
    return
  }
  if (local <= new Date()) {
    toast.warning('Elegí una fecha y hora a futuro.')
    return
  }

  isReserving.value = true
  try {
    // PATCH shipping first (same as the pay flow) — even for in-store
    // pickup we want a phone so the owner can call about delays.
    if (order.value?.status === 'draft') {
      await ordersService.update(orderUuid.value, {
        recipient_name: recipientName.value,
        street_line_1: streetLine1.value,
        street_line_2: streetLine2.value,
        city: city.value,
        postal_code: postalCode.value,
        country: country.value.toUpperCase(),
        shipping_phone: shippingPhone.value,
        shipping_email: shippingEmail.value,
        shipping_method: shippingMethod.value,
      })
    }
    const reserved = await ordersService.reserve(
      orderUuid.value,
      local.toISOString(),
    )
    order.value = reserved
    reserveModalOpen.value = false
    toast.success('Reservado. Te esperamos en la tienda para el retiro.')
    router.push({ name: 'confirmation', params: { uuid: reserved.uuid } })
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    const detail
      = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
    if (status === 403) {
      toast.error('Tu cuenta no tiene habilitada la reserva.')
    } else if (status === 400) {
      toast.error(detail ?? 'Datos de reserva inválidos.')
    } else if (status === 409) {
      toast.error(detail ?? 'El pedido ya no se puede reservar.')
    } else {
      toast.error('No pudimos reservar el pedido. Intentá de nuevo.')
    }
  } finally {
    isReserving.value = false
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

/**
 * Re-quote when the customer picks a different shipping speed. Quote
 * is server-driven (same /quote/ endpoint loadOrder uses), so the
 * displayed total reflects the authoritative multiplier the backend
 * will apply at place_order time. No debounce — radio clicks are
 * discrete, not slider drags.
 */
watch(shippingMethod, async (method) => {
  if (!order.value || order.value.kind === 'catalog') return
  if (!order.value.material) return
  try {
    const q = await ordersService.quote({
      material: order.value.material,
      width_mm: order.value.width_mm,
      height_mm: order.value.height_mm,
      quantity: order.value.quantity,
      with_relief: order.value.with_relief,
      with_tinta_blanca: order.value.with_tinta_blanca,
      with_barniz_brillo: order.value.with_barniz_brillo,
      with_barniz_opaco: order.value.with_barniz_opaco,
      shipping_method: method,
    })
    quotedTotalEur.value = q.total_eur
    quotedSubtotalEur.value = q.subtotal_eur
    quotedIvaEur.value = q.iva_eur
  } catch {
    // Silent — the existing quote stays visible. place_order will
    // compute correctly regardless.
  }
})

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
        <!-- Shipping method radio — sticker orders only (catalog orders
             don't run through the editor / sticker pricing, so they
             ship at the default 'normal' speed for now). -->
        <fieldset
          v-if="!clientSecret && !isCatalogOrder"
          class="flex flex-col gap-3"
        >
          <legend class="text-h3 font-bold text-text">
            Envío
          </legend>
          <p class="text-sm text-text-muted">
            La velocidad del envío suma un porcentaje al total.
          </p>
          <div class="flex flex-col gap-2">
            <label
              v-for="method in SHIPPING_OPTIONS"
              :key="method"
              class="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3"
            >
              <input
                v-model="shippingMethod"
                type="radio"
                :value="method"
                class="size-4 accent-primary"
                :data-testid="`shipping-method-${method}`"
              >
              <div class="flex-1">
                <p class="text-sm font-semibold text-text">
                  {{ SHIPPING_METHOD_LABELS[method] }}
                </p>
                <p class="text-xs text-text-muted">
                  Llega en {{ SHIPPING_METHOD_ETA[method] }}.
                </p>
              </div>
              <span class="text-sm text-text-muted">
                {{ SHIPPING_METHOD_SURCHARGE_LABEL[method] || 'Gratis' }}
              </span>
            </label>
          </div>
        </fieldset>

        <!-- Shipping form: visible until checkout succeeds -->
        <ShippingForm
          v-if="!clientSecret"
          :recipient-name="recipientName"
          :street-line1="streetLine1"
          :street-line2="streetLine2"
          :city="city"
          :postal-code="postalCode"
          :country="country"
          :shipping-phone="shippingPhone"
          :shipping-email="shippingEmail"
          @update:recipient-name="recipientName = $event"
          @update:street-line1="streetLine1 = $event"
          @update:street-line2="streetLine2 = $event"
          @update:city="city = $event"
          @update:postal-code="postalCode = $event"
          @update:country="country = $event"
          @update:shipping-phone="shippingPhone = $event"
          @update:shipping-email="shippingEmail = $event"
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
          <!-- Pay-online and Reserve-for-pickup are mutually exclusive
               outcomes of this screen. Reserve only renders for users
               whose can_reserve_orders flag is set (managed by the shop
               owner in /admin/users). -->
          <div class="flex flex-wrap items-center gap-2">
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
              v-if="!clientSecret && canReserve"
              variant="ghost"
              size="lg"
              :disabled="!formIsValid"
              data-testid="checkout-reserve"
              @click="openReserveModal"
            >
              Reservar y pagar en tienda
            </AppButton>
            <AppButton
              v-if="clientSecret"
              size="lg"
              data-testid="checkout-go-dashboard"
              @click="router.push('/dashboard')"
            >
              Ir al dashboard
            </AppButton>
          </div>
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
          :shipping-method="shippingMethod"
          :total-eur="totalEur"
          :subtotal-eur="subtotalEur"
          :iva-eur="ivaEur"
          :thumbnail-url="thumbnailUrl"
          :cta-loading="false"
          @continue="onPay"
        />
      </div>
    </div>

    <!-- Reserve-for-pickup modal. Opens when a whitelisted customer
         clicks "Reservar y pagar en tienda". Collects a pickup
         datetime; submit hits POST /orders/{uuid}/reserve/. -->
    <AppModal
      :open="reserveModalOpen"
      title="Reservar para retirar en tienda"
      size="md"
      @close="reserveModalOpen = false"
    >
      <div class="flex flex-col gap-4">
        <p class="text-sm text-text-muted">
          Tu pedido queda reservado a tu nombre. Lo pagás en efectivo
          al retirarlo. Elegí cuándo pasás por la tienda.
        </p>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <label
              for="reserve-pickup-date"
              class="text-sm font-medium text-text"
            >
              Fecha
            </label>
            <input
              id="reserve-pickup-date"
              v-model="pickupDate"
              type="date"
              required
              data-testid="reserve-pickup-date"
              class="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-text focus-visible:border-primary focus-visible:outline-none"
            >
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="reserve-pickup-time"
              class="text-sm font-medium text-text"
            >
              Hora
            </label>
            <input
              id="reserve-pickup-time"
              v-model="pickupTime"
              type="time"
              required
              data-testid="reserve-pickup-time"
              class="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-text focus-visible:border-primary focus-visible:outline-none"
            >
          </div>
        </div>

        <p class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          💶 Pagás en efectivo al retirar. Si no podés pasar el día
          elegido, hablanos para reprogramar.
        </p>
      </div>

      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <AppButton
            variant="ghost"
            :disabled="isReserving"
            @click="reserveModalOpen = false"
          >
            Cancelar
          </AppButton>
          <AppButton
            :loading="isReserving"
            data-testid="reserve-submit"
            @click="onReserve"
          >
            Confirmar reserva
          </AppButton>
        </div>
      </template>
    </AppModal>
  </section>
</template>
