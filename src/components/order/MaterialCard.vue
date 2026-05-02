<script setup lang="ts">
import { computed } from 'vue'
import { type Material, MATERIAL_LABELS } from '@/types/order'

interface Props {
  material: Material
  selected?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  selected: false,
})

defineEmits<{
  select: [material: Material]
}>()

/**
 * One-line tagline per material — surfaces the visual character so the customer
 * can pick without seeing real samples. Replace with real photos when assets land.
 */
const TAGLINES: Record<Material, string> = {
  vinilo_blanco: 'Acabado clásico',
  vinilo_transparente: 'Fondo invisible',
  holografico: 'Efecto arcoíris',
  holografico_transparente: 'Brillo sin fondo',
  plateado: 'Metálico premium',
  dorado: 'Brillo de oro',
  luminiscente: 'Brilla en la oscuridad',
  eggshell: 'Estilo natural',
  eggshell_holografico: 'Tornasol y antifraude',
}

/**
 * Tailwind utility describing each material's preview thumbnail. Tied to the
 * design tokens — when real material photos exist, replace this with an <img>.
 */
const SWATCH_CLASSES: Record<Material, string> = {
  vinilo_blanco: 'bg-gradient-to-br from-white via-gray-200 to-gray-300',
  vinilo_transparente:
    'bg-[linear-gradient(45deg,#374151_25%,transparent_25%,transparent_75%,#374151_75%),linear-gradient(45deg,#374151_25%,transparent_25%,transparent_75%,#374151_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]',
  holografico: 'bg-holographic',
  holografico_transparente: 'bg-holographic opacity-70',
  plateado: 'bg-gradient-to-br from-gray-200 via-gray-400 to-gray-600',
  dorado: 'bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-600',
  luminiscente: 'bg-gradient-to-br from-lime-200 via-lime-400 to-lime-600',
  eggshell: 'bg-gradient-to-br from-amber-50 via-amber-100 to-amber-200',
  eggshell_holografico: 'bg-gradient-to-br from-cyan-200 via-violet-200 to-pink-200',
}

const wrapperClasses = computed(() =>
  [
    'group flex flex-col gap-2 rounded-lg border bg-surface-1 p-4 text-left transition cursor-pointer',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    props.selected
      ? 'border-primary shadow-orange'
      : 'border-border hover:border-text-muted hover:bg-surface-2',
  ].join(' '),
)
</script>

<template>
  <button
    type="button"
    :class="wrapperClasses"
    :aria-pressed="selected"
    :data-testid="`material-${material}`"
    @click="$emit('select', material)"
  >
    <!-- Swatch -->
    <div
      :class="['aspect-square w-full rounded-md border border-border', SWATCH_CLASSES[material]]"
      aria-hidden="true"
    />
    <!-- Label + tagline -->
    <div>
      <p
        :class="[
          'text-sm font-semibold',
          selected ? 'text-primary' : 'text-text',
        ]"
      >
        {{ MATERIAL_LABELS[material] }}
      </p>
      <p class="text-xs text-text-muted">
        {{ TAGLINES[material] }}
      </p>
    </div>
  </button>
</template>
