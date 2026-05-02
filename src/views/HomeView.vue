<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'

const router = useRouter()
</script>

<template>
  <section class="mx-auto max-w-7xl px-6 py-16">
    <div class="grid gap-8 md:grid-cols-2 md:items-center">
      <div>
        <h1 class="text-display-lg font-bold leading-tight text-text">
          Tu diseño.<br>
          Tu sticker.<br>
          <span class="text-primary">Sin límites.</span>
        </h1>
        <p class="mt-6 max-w-md text-text-muted">
          Sube tu diseño, personaliza cada detalle, y nosotros lo convertimos en stickers de la
          mejor calidad.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
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
      <div
        class="aspect-square rounded-xl border border-border bg-orange-glow"
        aria-hidden="true"
      >
        <!-- Hero visual lands in Phase 2 -->
      </div>
    </div>
  </section>
</template>
