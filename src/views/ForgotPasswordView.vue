<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppCard from '@/components/ui/AppCard.vue'
import { useAuth } from '@/composables/useAuth'

const email = ref('')
const { requestPasswordReset, status, error } = useAuth()

function onSubmit() {
  requestPasswordReset({ email: email.value })
}
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-72px)] max-w-md items-center px-6 py-12">
    <AppCard class="w-full">
      <h1 class="text-h2 font-bold text-text">
        Recuperá tu contraseña
      </h1>
      <p class="mt-1 text-text-muted">
        Te enviamos un link para crear una nueva.
      </p>

      <form
        v-if="status !== 'success'"
        class="mt-6 flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <AppInput
          v-model="email"
          label="Email"
          type="email"
          autocomplete="email"
          required
        />
        <p
          v-if="error"
          class="text-sm text-error"
        >
          {{ error }}
        </p>
        <AppButton
          type="submit"
          :loading="status === 'loading'"
        >
          Enviar link
        </AppButton>
      </form>

      <div
        v-else
        class="mt-6 rounded-md border border-success/40 bg-success/10 p-4 text-sm text-success"
      >
        Si el email es válido, te enviamos un link para restablecer tu contraseña. Revisá tu bandeja.
      </div>

      <p class="mt-6 text-center text-sm text-text-muted">
        <RouterLink
          to="/login"
          class="text-primary hover:underline"
        >
          Volver al login
        </RouterLink>
      </p>
    </AppCard>
  </section>
</template>
