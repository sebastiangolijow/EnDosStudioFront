<script setup lang="ts">
import AppInput from '@/components/ui/AppInput.vue'
import { COUNTRIES } from '@/data/countries'

interface Props {
  recipientName: string
  streetLine1: string
  streetLine2: string
  city: string
  postalCode: string
  country: string
  /** Required at place_order. Pre-filled by parent from auth.user.phone_number. */
  shippingPhone: string
  /** Optional notification address. Pre-filled from auth.user.email. */
  shippingEmail: string
}

defineProps<Props>()

const emit = defineEmits<{
  'update:recipientName': [value: string]
  'update:streetLine1': [value: string]
  'update:streetLine2': [value: string]
  'update:city': [value: string]
  'update:postalCode': [value: string]
  'update:country': [value: string]
  'update:shippingPhone': [value: string]
  'update:shippingEmail': [value: string]
}>()

/**
 * Per the api-contract-check skill: backend field names are exactly
 * `recipient_name`, `street_line_1`, `street_line_2`, `city`, `postal_code`,
 * `country`. The view passes them through as snake_case to ordersService.update.
 *
 * Country is plain text for now — design pack doesn't specify a picker, and
 * the backend stores it as ISO-3166 alpha-2 (no validation in M2). The
 * placeholder makes the format expectation clear.
 */
function update<K extends keyof Props>(key: K, value: Props[K]) {
  // Map prop name (camelCase) to emit name. defineEmits' typed events handle
  // the rest — TS narrows correctly at the call site.
  switch (key) {
    case 'recipientName':  emit('update:recipientName', value as string); break
    case 'streetLine1':    emit('update:streetLine1', value as string); break
    case 'streetLine2':    emit('update:streetLine2', value as string); break
    case 'city':           emit('update:city', value as string); break
    case 'postalCode':     emit('update:postalCode', value as string); break
    case 'country':        emit('update:country', value as string); break
    case 'shippingPhone':  emit('update:shippingPhone', value as string); break
    case 'shippingEmail':  emit('update:shippingEmail', value as string); break
  }
}
</script>

<template>
  <fieldset class="flex flex-col gap-4">
    <legend class="mb-1 text-h3 font-bold text-text">
      Dirección de envío
    </legend>

    <AppInput
      :model-value="recipientName"
      label="Nombre del destinatario"
      autocomplete="name"
      required
      @update:model-value="(v) => update('recipientName', v)"
    />

    <AppInput
      :model-value="streetLine1"
      label="Dirección"
      placeholder="Calle, número"
      autocomplete="address-line1"
      required
      @update:model-value="(v) => update('streetLine1', v)"
    />

    <AppInput
      :model-value="streetLine2"
      label="Piso, puerta, referencias (opcional)"
      autocomplete="address-line2"
      @update:model-value="(v) => update('streetLine2', v)"
    />

    <div class="grid grid-cols-2 gap-3">
      <AppInput
        :model-value="city"
        label="Ciudad"
        autocomplete="address-level2"
        required
        @update:model-value="(v) => update('city', v)"
      />
      <AppInput
        :model-value="postalCode"
        label="Código postal"
        autocomplete="postal-code"
        required
        @update:model-value="(v) => update('postalCode', v)"
      />
    </div>

    <!-- Country dropdown — full ISO 3166-1 alpha-2 list, Spanish names.
         España pinned at the top of the list as the most common choice;
         the rest follows. Replaces a free-text input (too error-prone:
         customers were typing "Spain", "España" etc. which didn't match
         the 2-char wire format the backend expects). -->
    <div class="flex flex-col gap-1">
      <label
        for="shipping-country"
        class="text-sm font-medium text-text"
      >
        País
      </label>
      <select
        id="shipping-country"
        :value="country || 'ES'"
        autocomplete="country"
        required
        data-testid="shipping-country"
        class="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-text focus-visible:border-primary focus-visible:outline-none"
        @change="update('country', ($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="c in COUNTRIES"
          :key="c.code"
          :value="c.code"
        >
          {{ c.name }}
        </option>
      </select>
    </div>

    <!-- Contact for the courier — required at place_order (backend
         rejects with 409 if shipping_phone is empty). Email is
         optional, pre-filled from the customer's account email. -->
    <AppInput
      :model-value="shippingPhone"
      label="Teléfono de contacto"
      type="tel"
      autocomplete="tel"
      required
      placeholder="+34 600 123 456"
      helper="Para coordinar la entrega."
      data-testid="shipping-phone"
      @update:model-value="(v) => update('shippingPhone', v)"
    />

    <AppInput
      :model-value="shippingEmail"
      label="Email de envío (opcional)"
      type="email"
      autocomplete="email"
      placeholder="alternativa@ejemplo.com"
      helper="Si querés recibir el seguimiento en otro email."
      data-testid="shipping-email"
      @update:model-value="(v) => update('shippingEmail', v)"
    />
  </fieldset>
</template>
