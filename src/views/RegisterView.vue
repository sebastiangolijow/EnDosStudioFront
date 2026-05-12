<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppCard from '@/components/ui/AppCard.vue'
import { useAuth } from '@/composables/useAuth'

const email = ref('')
const password = ref('')
const firstName = ref('')
const lastName = ref('')
const phoneNumber = ref('')
const { register, status, error } = useAuth()

function onSubmit() {
  // Snake_case payload — mirrors the backend RegisterSerializer field names exactly.
  register({
    email: email.value,
    password: password.value,
    first_name: firstName.value,
    last_name: lastName.value,
    phone_number: phoneNumber.value,
  })
}
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-72px)] max-w-md items-center px-6 py-12">
    <AppCard class="w-full">
      <h1 class="text-h2 font-bold text-text">
        Crear cuenta
      </h1>
      <p class="mt-1 text-text-muted">
        Te enviaremos un email para confirmar.
      </p>

      <form
        v-if="status !== 'success'"
        class="mt-6 flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <div class="grid grid-cols-2 gap-3">
          <AppInput
            v-model="firstName"
            label="Nombre"
          />
          <AppInput
            v-model="lastName"
            label="Apellido"
          />
        </div>
        <AppInput
          v-model="email"
          label="Email"
          type="email"
          autocomplete="email"
          required
        />
        <AppInput
          v-model="phoneNumber"
          label="Teléfono"
          type="tel"
          autocomplete="tel"
          required
          placeholder="+34 600 123 456"
          helper="Lo usamos para coordinar el envío."
        />
        <AppInput
          v-model="password"
          label="Contraseña"
          type="password"
          autocomplete="new-password"
          required
          helper="Mínimo 8 caracteres."
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
          Crear cuenta
        </AppButton>
      </form>

      <div
        v-else
        class="mt-6 rounded-md border border-success/40 bg-success/10 p-4 text-sm text-success"
      >
        Si el email es válido, te enviamos un link para configurar tu contraseña. Revisá tu bandeja.
      </div>

      <p class="mt-6 text-center text-sm text-text-muted">
        ¿Ya tienes cuenta?
        <RouterLink
          to="/login"
          class="text-primary hover:underline"
        >
          Iniciar sesión
        </RouterLink>
      </p>
    </AppCard>
  </section>
</template>
