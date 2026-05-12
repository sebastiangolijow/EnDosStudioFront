<script setup lang="ts">
import { computed } from 'vue'
import { type Material, MATERIAL_LABELS } from '@/types/order'
import AppButton from '@/components/ui/AppButton.vue'

interface Props {
  /** Customer-selected material. Empty string = not picked yet. */
  material: Material | ''
  widthMm: number
  heightMm: number
  quantity: number
  withRelief: boolean
  withTintaBlanca: boolean
  withBarnizBrillo: boolean
  withBarnizOpaco: boolean
  /** Pre-formatted EUR string from /orders/quote/. Empty = quote pending. */
  totalEur: string
  /** Original-image URL from the order's files. Optional placeholder. */
  thumbnailUrl?: string | null
  isQuoting?: boolean
  /** Disable the CTA while a backend call is in flight. */
  ctaLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  thumbnailUrl: null,
  isQuoting: false,
  ctaLoading: false,
})

defineEmits<{
  continue: []
}>()

const sizeLabel = computed(() => {
  if (!props.widthMm || !props.heightMm) return '—'
  return `${props.widthMm / 10}×${props.heightMm / 10} cm`
})

const materialLabel = computed(() =>
  props.material ? MATERIAL_LABELS[props.material] : '—',
)

/** Active acabado label + surcharge (relieve/brillo/opaco are mutually
 *  exclusive — see OrderConfigView). Tinta blanca is independent and
 *  rendered separately. */
const acabadoLine = computed<{ label: string; surcharge: string } | null>(() => {
  if (props.withRelief) return { label: 'Relieve', surcharge: '+35%' }
  if (props.withBarnizBrillo) return { label: 'Barniz brillo', surcharge: '+20%' }
  if (props.withBarnizOpaco) return { label: 'Barniz opaco', surcharge: '+20%' }
  return null
})

/** Disable the CTA when the order isn't fully specified or while quoting. */
const ctaDisabled = computed(
  () =>
    props.ctaLoading ||
    !props.material ||
    !props.widthMm ||
    !props.heightMm ||
    !props.quantity ||
    !props.totalEur,
)
</script>

<template>
  <aside class="rounded-lg border border-border bg-surface-1 p-5 shadow-card">
    <h2 class="text-h3 font-semibold text-text">
      Resumen de tu pedido
    </h2>

    <!-- Sticker preview thumbnail -->
    <div class="mt-4 aspect-square overflow-hidden rounded-md border border-border bg-surface-2">
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        alt="Vista previa del diseño"
        class="size-full object-contain"
      >
      <div
        v-else
        class="size-full bg-holographic opacity-30"
        aria-hidden="true"
      />
    </div>

    <!-- Spec lines -->
    <dl class="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm">
      <div class="flex justify-between gap-3">
        <dt class="uppercase tracking-wide text-text-muted">
          Material
        </dt>
        <dd class="font-medium text-text">
          {{ materialLabel }}
        </dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="uppercase tracking-wide text-text-muted">
          Tamaño
        </dt>
        <dd class="font-medium text-text">
          {{ sizeLabel }}
        </dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="uppercase tracking-wide text-text-muted">
          Cantidad
        </dt>
        <dd class="font-medium text-text">
          {{ quantity }} unidades
        </dd>
      </div>
      <!-- Acabado — at most one of relieve/brillo/opaco can be true.
           Tinta blanca is independent and rendered as its own line. -->
      <div
        v-if="acabadoLine"
        class="flex justify-between gap-3"
      >
        <dt class="uppercase tracking-wide text-text-muted">
          Acabado
        </dt>
        <dd class="font-medium text-text">
          {{ acabadoLine.label }}
          <span class="text-text-muted">{{ acabadoLine.surcharge }}</span>
        </dd>
      </div>
      <div
        v-if="withTintaBlanca"
        class="flex justify-between gap-3"
      >
        <dt class="uppercase tracking-wide text-text-muted">
          + Tinta blanca
        </dt>
        <dd class="font-medium text-text">
          +35%
        </dd>
      </div>
    </dl>

    <!-- Total -->
    <div class="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
      <div class="flex justify-between text-text-muted">
        <span>Subtotal</span>
        <span data-testid="summary-subtotal">
          {{ totalEur ? `€${totalEur}` : '—' }}
        </span>
      </div>
      <div class="flex justify-between text-text-muted">
        <span>Envío</span>
        <span class="text-success">Gratis</span>
      </div>
      <div class="mt-2 flex items-baseline justify-between border-t border-border pt-3">
        <span class="font-semibold text-text">Total</span>
        <span
          class="text-h3 font-bold text-text"
          data-testid="summary-total"
        >
          {{ totalEur ? `€${totalEur} EUR` : (isQuoting ? 'Calculando…' : '—') }}
        </span>
      </div>
    </div>

    <AppButton
      class="mt-5 w-full"
      size="lg"
      :loading="ctaLoading"
      :disabled="ctaDisabled"
      data-testid="summary-continue"
      @click="$emit('continue')"
    >
      Continuar al pago 🔒
    </AppButton>

    <p class="mt-3 text-center text-xs text-text-muted">
      🌍 Envíos a todo el mundo
    </p>
  </aside>
</template>
