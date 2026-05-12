<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { useNewSticker } from '@/composables/useNewSticker'
import heroSticker from '@/assets/examples/hero-sticker-2.png'
import inspirate1 from '@/assets/inspirate/inspirate-1.png'
import inspirate2 from '@/assets/inspirate/inspirate-2.png'
import inspirate3 from '@/assets/inspirate/inspirate-3.png'
import inspirate4 from '@/assets/inspirate/inspirate-4.png'
import inspirate5 from '@/assets/inspirate/inspirate-5.png'
import inspirate6 from '@/assets/inspirate/inspirate-6.png'
import inspirate7 from '@/assets/inspirate/inspirate-7.png'
import inspirate8 from '@/assets/inspirate/inspirate-8.png'

const router = useRouter()
const { startNewSticker } = useNewSticker()

// "Cómo funciona" feature pills under the hero. Mirror the mockup copy
// verbatim. "Recorte inteligente" (was "Recorte automático con IA") —
// the rembg-backed pipeline IS the AI smart-cut path; the classical
// auto-cut is OpenCV with no IA involvement.
const features = [
  {
    icon: '✂️',
    title: 'Recorte inteligente',
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

// "Inspírate" gallery — client's curated Instagram posts. Each tile is
// a thumbnail (saved in src/assets/inspirate/) that opens the real
// Instagram post in a new tab. Hardcoded list — when the client wants
// to feature new posts, drop a new image into the assets folder and
// add an entry here. (See decision log in the home-page sessions: chose
// static assets over admin-managed because the client treats this as a
// curated "best of" row, not a live feed.)
//
// Shown 4 at a time by default; "Ver más" expands inline to 8. The
// remaining 4 slots are placeholders until the client supplies more
// posts.
interface InspirationItem {
  id: number
  image: string | null
  postUrl: string | null
  alt: string
}
const inspiration: InspirationItem[] = [
  {
    id: 1,
    image: inspirate1,
    postUrl: 'https://www.instagram.com/p/DX6z2--o2d4/',
    alt: 'Inspiración 1 — ver publicación en Instagram',
  },
  {
    id: 2,
    image: inspirate2,
    postUrl: 'https://www.instagram.com/p/DXyz6CVIeC3/',
    alt: 'Inspiración 2 — ver publicación en Instagram',
  },
  {
    id: 3,
    image: inspirate3,
    postUrl: 'https://www.instagram.com/p/DXWu5vbCEBo/',
    alt: 'Inspiración 3 — ver publicación en Instagram',
  },
  {
    id: 4,
    image: inspirate4,
    postUrl: 'https://www.instagram.com/p/C5EInx_MPIX/?img_index=1',
    alt: 'Inspiración 4 — ver publicación en Instagram',
  },
  {
    id: 5,
    image: inspirate5,
    postUrl: 'https://www.instagram.com/p/C4iGP0tsRFu/',
    alt: 'Inspiración 5 — ver publicación en Instagram',
  },
  {
    id: 6,
    image: inspirate6,
    postUrl: 'https://www.instagram.com/p/Cz_-3-8Mk9e/?img_index=1',
    alt: 'Inspiración 6 — ver publicación en Instagram',
  },
  {
    id: 7,
    image: inspirate7,
    postUrl: 'https://www.instagram.com/p/DGKs2MXs1NA/',
    alt: 'Inspiración 7 — ver publicación en Instagram',
  },
  {
    id: 8,
    image: inspirate8,
    postUrl: 'https://www.instagram.com/p/DG6CtcLs2ac/',
    alt: 'Inspiración 8 — ver publicación en Instagram',
  },
]
const inspirationExpanded = ref(false)
const visibleInspiration = computed(() =>
  inspirationExpanded.value ? inspiration : inspiration.slice(0, 4),
)
</script>

<template>
  <!-- HERO — sized so hero + Cómo funciona pills BOTH fit above the
       fold on a typical laptop (1080-1440 px tall). 70svh - header
       leaves ~100 px for the pills section to land just at or above
       the fold. Inspírate stays well below. -->
  <section class="flex h-[calc(70svh-88px)] min-h-[480px] flex-col justify-center overflow-hidden px-8 pt-8 md:px-12 md:pt-12 lg:px-16">
    <div class="grid h-full gap-12 md:grid-cols-2 md:items-center">
      <!-- Left: copy + CTAs. Padded inward (md:pl-8 lg:pl-16) so the
           headline doesn't hug the screen edge — sits a bit further
           toward the page center, closer to the hero visual. -->
      <div class="md:pl-8 lg:pl-16">
        <h1 class="text-[72px] font-bold leading-[1.02] tracking-tight text-text md:text-[80px] lg:text-[88px]">
          TU DISEÑO.<br>
          TU STICKER.<br>
          <span class="text-primary">SIN LÍMITES.</span>
        </h1>
        <p class="mt-8 max-w-xl text-xl text-text-muted">
          Sube tu diseño, personaliza cada detalle, y nosotros lo convertimos en stickers de la
          mejor calidad.
        </p>
        <div class="mt-10 flex flex-wrap items-center gap-4">
          <AppButton
            size="lg"
            data-testid="home-view-new-sticker"
            @click="startNewSticker"
          >
            Subir mi diseño
          </AppButton>
          <AppButton
            variant="ghost"
            size="lg"
            data-testid="home-view-catalog"
            @click="router.push('/catalogo')"
          >
            Ver catálogo →
          </AppButton>
        </div>
      </div>

      <!-- Right: hero sticker visual on cosmic backdrop. The container is
           sized to fit WITHIN the hero section's fixed height (the
           outer flex item provides h-full; aspect-square would
           otherwise drive the box from width and overflow on wide
           screens). max-h-full + aspect-square + mx-auto means the
           square shrinks to whatever fits and stays centered in the
           grid cell. -->
      <div class="relative mx-auto aspect-square h-full max-h-full overflow-hidden rounded-xl border border-border">
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

  </section>

  <!-- CÓMO FUNCIONA — feature pills row, with a section title matching
       Inspírate. Pills are centered within a max-width container so they
       don't run flush to the screen edges (the cards' meaning is at
       human-reading width, not desktop-wide). -->
  <section
    id="how"
    class="px-8 pb-16 pt-8 md:px-12 lg:px-16"
  >
    <div class="mb-8 flex items-center justify-between">
      <h2 class="text-h2 font-bold uppercase tracking-tight text-text">
        Cómo funciona
      </h2>
    </div>
    <div class="grid gap-6 md:grid-cols-4">
      <div
        v-for="feat in features"
        :key="feat.title"
        class="flex items-center gap-5 rounded-2xl border border-border bg-surface-1 px-8 py-7"
      >
        <span
          class="text-4xl"
          aria-hidden="true"
        >{{ feat.icon }}</span>
        <div class="leading-tight">
          <p class="text-lg font-semibold text-text">
            {{ feat.title }}
          </p>
          <p class="text-base text-text-muted">
            {{ feat.sub }}
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- INSPIRATION — full-width, 4 columns on desktop so each tile is
       large enough that sample stickers read at a glance. -->
  <section
    id="inspiration"
    class="px-8 pb-24 pt-12 md:px-12 lg:px-16"
  >
    <div class="mb-8 flex items-center justify-between">
      <h2 class="text-h2 font-bold uppercase tracking-tight text-text">
        Inspírate
      </h2>
      <button
        type="button"
        class="text-base text-text-muted transition hover:text-text"
        @click="inspirationExpanded = !inspirationExpanded"
      >
        {{ inspirationExpanded ? '← Ver menos' : 'Ver más →' }}
      </button>
    </div>
    <div class="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
      <component
        :is="item.postUrl ? 'a' : 'div'"
        v-for="item in visibleInspiration"
        :key="item.id"
        :href="item.postUrl ?? undefined"
        :target="item.postUrl ? '_blank' : undefined"
        :rel="item.postUrl ? 'noopener noreferrer' : undefined"
        :aria-label="item.alt || undefined"
        class="group relative block aspect-square overflow-hidden rounded-xl border border-border bg-surface-1 transition hover:border-primary"
      >
        <img
          v-if="item.image"
          :src="item.image"
          :alt="item.alt"
          class="size-full object-cover transition duration-300 group-hover:scale-105"
          loading="lazy"
          decoding="async"
        >
        <!-- Placeholder gradient when no image yet (slots 5-8) -->
        <div
          v-else
          class="size-full bg-holographic opacity-30"
          aria-hidden="true"
        />
      </component>
    </div>
  </section>
</template>
