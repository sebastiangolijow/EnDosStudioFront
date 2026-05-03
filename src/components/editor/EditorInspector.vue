<script setup lang="ts">
import { type AutoCropOptions } from '@/composables/useAutoCropWorker'
import { type Material, MATERIAL_LABELS, type Shape, SHAPE_LABELS } from '@/types/order'
import { MATERIAL_TEXTURE_URLS } from '@/utils/materialColors'

interface Props {
  /** Show/hide the mask layer. v-model:mask-visible. */
  maskVisible: boolean
  /** Auto-crop tunables. v-model:options. */
  options: AutoCropOptions
  /** Currently selected material — drives halo color + persists to draft. */
  material: Material | ''
  /** Cut shape — drives whether Auto cut is meaningful (contorneado only). */
  shape: Shape
  /** Whether the customer wants relief on this sticker. */
  withRelief: boolean
  /** Free-text note describing where relief should go. Shown when withRelief. */
  reliefNote: string
}

defineProps<Props>()

defineEmits<{
  'update:maskVisible': [value: boolean]
  'update:options': [value: AutoCropOptions]
  'update:material': [value: Material | '']
  'update:shape': [value: Shape]
  'update:withRelief': [value: boolean]
  'update:reliefNote': [value: string]
}>()

const SHAPES: Shape[] = ['contorneado', 'cuadrado', 'circulo', 'redondeadas']

/**
 * Materials available for the in-editor compact picker. Same enum the
 * order-config grid uses; we just present them as a tight scrollable list
 * so the editor's narrow right rail fits all nine without overflow.
 *
 * Single-color thumbnail next to each label is a CSS gradient — replace
 * with real photos when assets land. Mirrors MaterialCard's SWATCH_CLASSES
 * but slimmer (24×24 vs. card-aspect-square) for this denser layout.
 */
const MATERIALS: Material[] = [
  'holografico',
  'holografico_transparente',
  'vinilo_blanco',
  'vinilo_transparente',
  'plateado',
  'dorado',
  'luminiscente',
  'eggshell',
  'eggshell_holografico',
]

const SWATCH_CLASSES: Record<Material, string> = {
  vinilo_blanco: 'bg-gradient-to-br from-white via-gray-200 to-gray-300',
  vinilo_transparente:
    'bg-[linear-gradient(45deg,#374151_25%,transparent_25%,transparent_75%,#374151_75%),linear-gradient(45deg,#374151_25%,transparent_25%,transparent_75%,#374151_75%)] bg-[length:8px_8px] bg-[position:0_0,4px_4px]',
  holografico: 'bg-holographic',
  holografico_transparente: 'bg-holographic opacity-70',
  plateado: 'bg-gradient-to-br from-gray-200 via-gray-400 to-gray-600',
  dorado: 'bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-600',
  luminiscente: 'bg-gradient-to-br from-lime-200 via-lime-400 to-lime-600',
  eggshell: 'bg-gradient-to-br from-amber-50 via-amber-100 to-amber-200',
  eggshell_holografico: 'bg-gradient-to-br from-cyan-200 via-violet-200 to-pink-200',
}
</script>

<template>
  <aside
    aria-label="Ajustes del recorte"
    class="flex flex-col gap-5 rounded-lg border border-border bg-surface-1 p-5"
  >
    <!-- ===== Forma ===== -->
    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted">
      Forma
    </h2>
    <div class="grid grid-cols-2 gap-2">
      <button
        v-for="s in SHAPES"
        :key="s"
        type="button"
        :class="[
          'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs transition',
          shape === s
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-text hover:bg-surface-2',
        ]"
        :data-testid="`inspector-shape-${s}`"
        :aria-pressed="shape === s"
        @click="$emit('update:shape', s)"
      >
        <svg
          v-if="s === 'contorneado'"
          viewBox="0 0 24 24"
          class="size-4 shrink-0"
          aria-hidden="true"
        >
          <path
            d="M5 8 Q4 4 9 5 T15 4 Q21 5 19 11 T22 19 Q19 22 14 20 T7 22 Q2 20 4 14 T5 8 Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
        <svg
          v-else-if="s === 'cuadrado'"
          viewBox="0 0 24 24"
          class="size-4 shrink-0"
          aria-hidden="true"
        >
          <rect
            x="4"
            y="4"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
        <svg
          v-else-if="s === 'circulo'"
          viewBox="0 0 24 24"
          class="size-4 shrink-0"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
        <svg
          v-else
          viewBox="0 0 24 24"
          class="size-4 shrink-0"
          aria-hidden="true"
        >
          <rect
            x="4"
            y="4"
            width="16"
            height="16"
            rx="4"
            ry="4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
        <span class="leading-tight">{{ SHAPE_LABELS[s] }}</span>
      </button>
    </div>

    <hr class="border-border">

    <!-- ===== Material ===== -->
    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted">
      Material
    </h2>
    <p class="-mt-3 text-xs text-text-muted">
      El halo de corte usa el color del material elegido.
    </p>
    <div class="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
      <button
        v-for="m in MATERIALS"
        :key="m"
        type="button"
        :class="[
          'flex w-full items-center gap-3 rounded-md border px-2 py-2 text-left text-sm transition',
          material === m
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-transparent text-text hover:bg-surface-2',
        ]"
        :data-testid="`inspector-material-${m}`"
        :aria-pressed="material === m"
        @click="$emit('update:material', m)"
      >
        <!-- Real texture if bundled, CSS gradient otherwise. The wrapper
             keeps the size-6 circle constant so the row layout doesn't
             jiggle when textures finish loading. -->
        <span
          class="size-6 shrink-0 overflow-hidden rounded-full border border-border"
          aria-hidden="true"
        >
          <img
            v-if="MATERIAL_TEXTURE_URLS[m]"
            :src="MATERIAL_TEXTURE_URLS[m]"
            :alt="''"
            class="size-full object-cover"
            loading="lazy"
            decoding="async"
          >
          <span
            v-else
            :class="['block size-full', SWATCH_CLASSES[m]]"
          />
        </span>
        <span class="leading-tight">{{ MATERIAL_LABELS[m] }}</span>
      </button>
    </div>

    <hr class="border-border">

    <!-- ===== Relieve ===== -->
    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted">
      Relieve
    </h2>
    <label class="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        :checked="withRelief"
        class="mt-0.5 size-4 accent-primary"
        data-testid="toggle-with-relief"
        @change="$emit('update:withRelief', ($event.target as HTMLInputElement).checked)"
      >
      <span class="flex-1 text-sm text-text">
        Añadir relieve
        <span class="block text-xs text-text-muted">
          Realza zonas específicas del sticker (texto, logo).
        </span>
      </span>
    </label>
    <textarea
      v-if="withRelief"
      :value="reliefNote"
      placeholder="Indicá dónde querés el relieve (ej: solo el logo, el texto principal…)."
      rows="3"
      class="w-full rounded-md border border-border bg-surface-2 p-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none"
      data-testid="relief-note"
      @input="$emit('update:reliefNote', ($event.target as HTMLTextAreaElement).value)"
    />

    <hr class="border-border">

    <!-- ===== Vista ===== -->
    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted">
      Vista
    </h2>

    <!-- Mask visibility toggle -->
    <label class="flex items-center justify-between gap-3 cursor-pointer">
      <span class="text-sm text-text">Línea de corte</span>
      <input
        type="checkbox"
        :checked="maskVisible"
        class="size-4 accent-primary"
        data-testid="toggle-mask-visible"
        @change="$emit('update:maskVisible', ($event.target as HTMLInputElement).checked)"
      >
    </label>

    <hr class="border-border">

    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted">
      Margen
    </h2>

    <!-- Bleed margin (mm) — outward offset around the auto-detected
         contour. 15 mm is the print-shop default; some products want
         more (10–25). The slider re-runs auto-crop debounced. -->
    <div>
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <label class="text-sm text-text">Margen alrededor</label>
        <span class="text-xs text-text-muted">{{ options.marginMm ?? 15 }} mm</span>
      </div>
      <input
        type="range"
        min="0"
        max="30"
        step="1"
        :value="options.marginMm ?? 15"
        class="w-full accent-primary"
        data-testid="slider-margin-mm"
        @input="$emit('update:options', { ...options, marginMm: Number(($event.target as HTMLInputElement).value) })"
      >
    </div>

    <hr class="border-border">

    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted">
      Detección
    </h2>

    <!-- Canny low threshold -->
    <div>
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <label class="text-sm text-text">Umbral bajo</label>
        <span class="text-xs text-text-muted">{{ options.cannyLow ?? 50 }}</span>
      </div>
      <input
        type="range"
        min="10"
        max="150"
        step="5"
        :value="options.cannyLow ?? 50"
        class="w-full accent-primary"
        data-testid="slider-canny-low"
        @input="$emit('update:options', { ...options, cannyLow: Number(($event.target as HTMLInputElement).value) })"
      >
    </div>

    <!-- Canny high threshold -->
    <div>
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <label class="text-sm text-text">Umbral alto</label>
        <span class="text-xs text-text-muted">{{ options.cannyHigh ?? 150 }}</span>
      </div>
      <input
        type="range"
        min="50"
        max="300"
        step="5"
        :value="options.cannyHigh ?? 150"
        class="w-full accent-primary"
        data-testid="slider-canny-high"
        @input="$emit('update:options', { ...options, cannyHigh: Number(($event.target as HTMLInputElement).value) })"
      >
    </div>

    <!-- Blur radius -->
    <div>
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <label class="text-sm text-text">Suavizado</label>
        <span class="text-xs text-text-muted">{{ options.blurRadius ?? 5 }} px</span>
      </div>
      <input
        type="range"
        min="1"
        max="15"
        step="2"
        :value="options.blurRadius ?? 5"
        class="w-full accent-primary"
        data-testid="slider-blur"
        @input="$emit('update:options', { ...options, blurRadius: Number(($event.target as HTMLInputElement).value) })"
      >
    </div>

    <!-- Polygon epsilon -->
    <div>
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <label class="text-sm text-text">Simplificación</label>
        <span class="text-xs text-text-muted">{{ options.polyEpsilon ?? 2 }}</span>
      </div>
      <input
        type="range"
        min="0.5"
        max="10"
        step="0.5"
        :value="options.polyEpsilon ?? 2"
        class="w-full accent-primary"
        data-testid="slider-epsilon"
        @input="$emit('update:options', { ...options, polyEpsilon: Number(($event.target as HTMLInputElement).value) })"
      >
    </div>

    <p class="text-xs text-text-muted">
      Ajustá los valores si la línea de corte no captura bien el contorno de tu sticker.
    </p>
  </aside>
</template>
