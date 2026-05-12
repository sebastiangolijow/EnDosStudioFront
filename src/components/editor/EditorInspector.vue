<script setup lang="ts">
import { type AutoCropOptions } from '@/composables/useAutoCropWorker'
import { type Material, MATERIAL_LABELS, type Shape, SHAPE_LABELS } from '@/types/order'
import { MATERIAL_TEXTURE_URLS } from '@/utils/materialColors'

interface Props {
  /** Show/hide the mask layer. v-model:mask-visible. */
  maskVisible: boolean
  /** Clip the artwork to the cut polygon (background becomes transparent). */
  removeBackground: boolean
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
  /** Cut-line smoothing slider (0–10). Drives Chaikin iterations on the
   *  rendered polygon. 0 = follow silhouette tightly; 10 = very wavy,
   *  no detail. v-model:smoothing. Updates instantly (no auto-crop re-run). */
  smoothing: number
  /** When true, the customer has already committed to a shape (either by
   *  picking a geometric shape, which applies a mask immediately, or by
   *  running Auto cut / Smart cut on contorneado). Other shape buttons
   *  are disabled until they hit Borrar — switching shape→shape directly
   *  produced visible glitches. */
  hasActiveMask: boolean
}

const props = defineProps<Props>()

defineEmits<{
  'update:maskVisible': [value: boolean]
  'update:removeBackground': [value: boolean]
  'update:options': [value: AutoCropOptions]
  'update:material': [value: Material | '']
  'update:shape': [value: Shape]
  'update:withRelief': [value: boolean]
  'update:reliefNote': [value: string]
  'update:smoothing': [value: number]
}>()

const SHAPES: Shape[] = [
  'contorneado',
  'cuadrado',
  'circulo',
  'oval',
  'redondeadas',
]

/** Margin slider bounds. Contorneado floors at 5 mm (real die-cut
 *  tolerance — below this the artwork would print clipped at the
 *  edge). Geometric shapes accept NEGATIVE margins so the customer
 *  can crop into the artwork itself (e.g. cut off the edge of a
 *  logo) — the cut line is a primitive the customer drew on top of
 *  the design, no physical print tolerance applies. */
function marginMinFor(shape: Shape): number {
  return shape === 'contorneado' ? 5 : -30
}
const MARGIN_MAX = 30

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
    class="flex flex-col gap-5 rounded-lg border border-border bg-surface-1 p-5 lg:h-full lg:max-h-[calc(100svh-240px)] lg:min-h-0 lg:overflow-y-auto"
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
        :disabled="props.hasActiveMask && shape !== s"
        :class="[
          'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs transition',
          shape === s
            ? 'border-primary bg-primary/10 text-primary'
            : props.hasActiveMask
              ? 'cursor-not-allowed border-border text-text-muted opacity-50'
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
          v-else-if="s === 'oval'"
          viewBox="0 0 24 24"
          class="size-4 shrink-0"
          aria-hidden="true"
        >
          <ellipse
            cx="12"
            cy="12"
            rx="9"
            ry="5"
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
    <p
      v-if="props.hasActiveMask"
      class="text-xs text-text-muted"
      data-testid="inspector-shape-locked-hint"
    >
      Tocá <span class="font-semibold text-text">Borrar</span> para cambiar de forma.
    </p>

    <hr class="border-border">

    <!-- ===== Material ===== -->
    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted">
      Material
    </h2>
    <p class="text-xs text-text-muted">
      El halo de corte usa el color del material elegido.
    </p>
    <div class="flex max-h-72 shrink-0 flex-col gap-1 overflow-y-auto pr-1">
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

    <!-- Background-removal toggle: when ON, the base image is clipped
         to the tight ARTWORK polygon (no bleed), letting the colored
         halo show in the bleed margin. When OFF, the base image clips
         to the FULL cut polygon (bleed included) so the customer sees
         the printed sticker as it'd arrive — full bleed, no halo
         peek-through. -->
    <label class="flex items-center justify-between gap-3 cursor-pointer">
      <span class="text-sm text-text">
        Quitar fondo
        <span class="block text-xs text-text-muted">
          Recorta más cerca del diseño y deja ver el halo del material en el margen.
        </span>
      </span>
      <input
        type="checkbox"
        :checked="removeBackground"
        class="size-4 accent-primary"
        data-testid="toggle-remove-bg"
        @change="$emit('update:removeBackground', ($event.target as HTMLInputElement).checked)"
      >
    </label>

    <hr class="border-border">

    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted">
      Margen y forma
    </h2>

    <!-- Bleed margin (mm) — outward offset around the cut line.
         Range depends on shape:
           - contorneado: 5 to 30 mm (5 mm floor = die-cut tolerance;
             below it the artwork prints clipped at the edge)
           - geometric (cuadrado/circulo/redondeadas): -30 to 30 mm.
             Negative values crop INTO the artwork — useful when the
             customer wants to cut off the edge of a logo on purpose.
         15 mm is the default. The slider re-runs classical Auto cut
         debounced; for smart-cut it re-calls the backend with the
         new margin. -->
    <div>
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <label class="text-sm text-text">Margen alrededor</label>
        <span class="text-xs text-text-muted">{{ options.marginMm ?? 15 }} mm</span>
      </div>
      <input
        type="range"
        :min="marginMinFor(shape)"
        :max="MARGIN_MAX"
        step="1"
        :value="options.marginMm ?? 15"
        class="w-full accent-primary"
        data-testid="slider-margin-mm"
        @input="$emit('update:options', { ...options, marginMm: Number(($event.target as HTMLInputElement).value) })"
      >
      <p
        v-if="shape !== 'contorneado'"
        class="mt-1 text-xs text-text-muted"
      >
        Podés llevar el margen a valores negativos para cortar dentro del diseño.
      </p>
    </div>

    <!-- Cut-line smoothing — perimeter-Gaussian passes on the polygon.
         Updates instantly without re-running OpenCV. Min is intentionally
         2 (not 0): at fewer passes, sharp concavities in the silhouette
         (fur tufts on the gorilla, hair tips, etc.) cause the per-vertex
         normal-offset to self-intersect, producing visible spikes/loops
         around the cut line. The print shop wouldn't accept a polygon
         like that anyway, so we floor the slider to keep the customer
         in usable territory. 2 = barely smoothed (silhouette detail
         preserved); 10 = fully wavy. -->
    <div>
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <label class="text-sm text-text">Suavidad</label>
        <span class="text-xs text-text-muted">{{ smoothing }}</span>
      </div>
      <input
        type="range"
        min="2"
        max="10"
        step="1"
        :value="smoothing"
        class="w-full accent-primary"
        data-testid="slider-smoothing"
        @input="$emit('update:smoothing', Number(($event.target as HTMLInputElement).value))"
      >
      <p class="mt-1 text-xs text-text-muted">
        Prolijidad de los bordes
      </p>
    </div>

    <!--
      The previous "Detección" section (Canny thresholds + pre-blur) was
      removed because those sliders only affect the Canny strategy, which
      is the LAST of three detection strategies and rarely runs in
      practice (alpha + bg-trim cover almost every real customer image).
      Customers were getting confused dragging sliders that did nothing.

      Defaults (cannyLow=50, cannyHigh=150, blurRadius=5) still live in
      the worker so Canny still works when it does run; we just don't
      expose them in the UI.
    -->
  </aside>
</template>
