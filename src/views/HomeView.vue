<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import heroSticker from '@/assets/examples/hero-sticker.png'

const router = useRouter()

// Four feature pills under the hero. Mirror the mockup copy verbatim.
// Each pill is icon + 2-line text. Icons are unicode for Phase 1; swap to
// Heroicons / Lucide when an icon system lands.
const features = [
  {
    icon: '✂️',
    title: 'Recorte automático',
    sub: 'con IA',
  },
  {
    icon: '🌟',
    title: 'Zonas de relieve',
    sub: 'personalizadas',
  },
  {
    icon: '✨',
    title: 'Materiales premium',
    sub: 'y holográficos',
  },
  {
    icon: '🌍',
    title: 'Envíos a todo',
    sub: 'el mundo',
  },
]

// "Inspírate" gallery — 6 sticker thumbnails. Phase 1 placeholders are
// holographic-tinted boxes; swap to real sample stickers when assets are ready.
const inspiration = Array.from({ length: 6 }, (_, i) => ({ id: i }))
</script>

<template>
  <!-- HERO -->
  <section class="mx-auto max-w-7xl px-6 pb-16 pt-12 md:pt-20">
    <div class="grid gap-12 md:grid-cols-2 md:items-center">
      <!-- Left: copy + CTAs -->
      <div>
        <h1 class="text-display-lg font-bold leading-[1.05] tracking-tight text-text">
          TU DISEÑO.<br>
          TU STICKER.<br>
          <span class="text-primary">SIN LÍMITES.</span>
        </h1>
        <p class="mt-6 max-w-md text-base text-text-muted">
          Sube tu diseño, personaliza cada detalle, y nosotros lo convertimos en stickers de la
          mejor calidad.
        </p>
        <div class="mt-8 flex flex-wrap items-center gap-3">
          <AppButton
            size="lg"
            @click="router.push('/upload')"
          >
            Subir mi diseño
          </AppButton>
          <AppButton
            variant="ghost"
            size="lg"
            @click="router.push('/#how')"
          >
            Ver cómo funciona →
          </AppButton>
        </div>
      </div>

      <!-- Right: hero sticker visual on cosmic backdrop -->
      <div class="relative aspect-square overflow-hidden rounded-xl border border-border">
        <!-- Cosmic gradient layer -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-violet-900/30 via-bg to-cyan-900/20"
          aria-hidden="true"
        />
        <!-- Orange glow halo behind the sticker -->
        <div
          class="absolute inset-0 bg-orange-glow"
          aria-hidden="true"
        />
        <!-- Hero sticker — real transparent PNG (RGBA). Drop-shadow uses the
             brand orange to sell depth against the cosmic backdrop. -->
        <div class="relative flex h-full items-center justify-center p-6">
          <img
            :src="heroSticker"
            alt="Ejemplo de sticker holográfico personalizado"
            class="size-full max-h-[90%] object-contain drop-shadow-[0_20px_60px_rgba(255,61,10,0.35)]"
            loading="eager"
            decoding="async"
          >
        </div>
      </div>
    </div>

    <!-- Four feature pills -->
    <div class="mt-12 grid gap-3 md:grid-cols-4">
      <div
        v-for="feat in features"
        :key="feat.title"
        class="flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3"
      >
        <span
          class="text-xl"
          aria-hidden="true"
        >{{ feat.icon }}</span>
        <div class="text-sm leading-tight">
          <p class="font-semibold text-text">
            {{ feat.title }}
          </p>
          <p class="text-text-muted">
            {{ feat.sub }}
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- INSPIRATION -->
  <section
    id="inspiration"
    class="mx-auto max-w-7xl px-6 pb-20"
  >
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-h3 font-bold uppercase tracking-tight text-text">
        Inspírate
      </h2>
      <RouterLink
        to="/inspiration"
        class="text-sm text-text-muted hover:text-text"
      >
        Ver más →
      </RouterLink>
    </div>
    <div class="grid grid-cols-2 gap-3 md:grid-cols-6">
      <div
        v-for="item in inspiration"
        :key="item.id"
        class="aspect-square overflow-hidden rounded-lg border border-border bg-surface-1"
      >
        <!-- Placeholder — swap to <img> with sample sticker assets later -->
        <div
          class="h-full w-full bg-holographic opacity-30"
          aria-hidden="true"
        />
      </div>
    </div>
  </section>
</template>
