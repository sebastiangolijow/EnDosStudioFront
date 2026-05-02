<script setup lang="ts">
import { type AutoCropOptions } from '@/composables/useAutoCropWorker'

interface Props {
  /** Show/hide the mask layer. v-model:mask-visible. */
  maskVisible: boolean
  /** Auto-crop tunables. v-model:options. */
  options: AutoCropOptions
}

defineProps<Props>()

defineEmits<{
  'update:maskVisible': [value: boolean]
  'update:options': [value: AutoCropOptions]
}>()
</script>

<template>
  <aside
    aria-label="Ajustes del recorte"
    class="flex flex-col gap-5 rounded-lg border border-border bg-surface-1 p-5"
  >
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
