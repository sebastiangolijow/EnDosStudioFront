<script setup lang="ts">
import { computed } from 'vue'
import { type Shape, SHAPE_LABELS } from '@/types/order'

interface Props {
  shape: Shape
  selected?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  selected: false,
})

defineEmits<{
  select: [shape: Shape]
}>()

/**
 * One-line tagline per shape — sets expectations about what the customer
 * is actually picking. `contorneado` is the default and points at the
 * editor; the geometric shapes ship without entering the editor at all.
 */
const TAGLINES: Record<Shape, string> = {
  contorneado: 'La línea de corte sigue el contorno del diseño.',
  cuadrado: 'Corte rectangular del tamaño elegido.',
  circulo: 'Círculo del tamaño elegido.',
  oval: 'Óvalo horizontal 2:1, tipo credencial.',
  redondeadas: 'Rectángulo con esquinas redondeadas.',
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
    :data-testid="`shape-${shape}`"
    @click="$emit('select', shape)"
  >
    <!-- Visual preview — a small SVG matching the shape so the customer
         doesn't have to read the label to understand the option. -->
    <div class="flex aspect-square w-full items-center justify-center rounded-md border border-border bg-surface-2 p-3">
      <svg
        v-if="shape === 'contorneado'"
        viewBox="0 0 64 64"
        class="size-full"
        aria-hidden="true"
      >
        <path
          d="M16 22 Q12 12 24 14 T40 10 Q56 14 52 28 T58 50 Q50 56 38 52 T18 56 Q6 50 12 38 T16 22 Z"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          class="text-primary"
        />
      </svg>
      <svg
        v-else-if="shape === 'cuadrado'"
        viewBox="0 0 64 64"
        class="size-full"
        aria-hidden="true"
      >
        <rect
          x="10"
          y="10"
          width="44"
          height="44"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          class="text-primary"
        />
      </svg>
      <svg
        v-else-if="shape === 'circulo'"
        viewBox="0 0 64 64"
        class="size-full"
        aria-hidden="true"
      >
        <circle
          cx="32"
          cy="32"
          r="22"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          class="text-primary"
        />
      </svg>
      <svg
        v-else
        viewBox="0 0 64 64"
        class="size-full"
        aria-hidden="true"
      >
        <rect
          x="10"
          y="10"
          width="44"
          height="44"
          rx="10"
          ry="10"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          class="text-primary"
        />
      </svg>
    </div>
    <!-- Label + tagline -->
    <div>
      <p
        :class="[
          'text-sm font-semibold',
          selected ? 'text-primary' : 'text-text',
        ]"
      >
        {{ SHAPE_LABELS[shape] }}
      </p>
      <p class="text-xs text-text-muted">
        {{ TAGLINES[shape] }}
      </p>
    </div>
  </button>
</template>
