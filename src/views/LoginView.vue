<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppCard from '@/components/ui/AppCard.vue'
import { useAuth } from '@/composables/useAuth'

const email = ref('')
const password = ref('')
const { login, status, error } = useAuth()

function onSubmit() {
  login({ email: email.value, password: password.value })
}
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-72px)] max-w-md items-center px-6 py-12">
    <AppCard class="w-full">
      <h1 class="text-h2 font-bold text-text">
        Entra a tu cuenta
      </h1>
      <p class="mt-1 text-text-muted">
        Guarda diseños, pedidos y archivos.
      </p>

      <form
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
        <AppInput
          v-model="password"
          label="Contraseña"
          type="password"
          autocomplete="current-password"
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
          Entrar
        </AppButton>
      </form>

      <p class="mt-3 text-center text-sm">
        <RouterLink
          to="/forgot-password"
          class="text-text-muted hover:text-text"
        >
          ¿Olvidaste tu contraseña?
        </RouterLink>
      </p>

      <p class="mt-6 text-center text-sm text-text-muted">
        ¿No tienes cuenta?
        <RouterLink
          to="/register"
          class="text-primary hover:underline"
        >
          Crear cuenta
        </RouterLink>
      </p>
    </AppCard>
  </section>
</template>
