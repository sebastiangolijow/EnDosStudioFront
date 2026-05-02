<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppCard from '@/components/ui/AppCard.vue'
import { useAuth } from '@/composables/useAuth'

const route = useRoute()
const password = ref('')
const { setPassword, status, error } = useAuth()

const email = computed(() => (route.query.email as string) ?? '')
const token = computed(() => (route.query.token as string) ?? '')
const validParams = computed(() => !!email.value && !!token.value)

function onSubmit() {
  setPassword({ email: email.value, token: token.value, password: password.value })
}
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-72px)] max-w-md items-center px-6 py-12">
    <AppCard class="w-full">
      <h1 class="text-h2 font-bold text-text">
        Configurá tu contraseña
      </h1>

      <div
        v-if="!validParams"
        class="mt-6 rounded-md border border-error/40 bg-error/10 p-4 text-sm text-error"
      >
        Enlace inválido. Pedí uno nuevo desde la pantalla de registro.
      </div>

      <form
        v-else
        class="mt-6 flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <p class="text-sm text-text-muted">
          Email: {{ email }}
        </p>
        <AppInput
          v-model="password"
          label="Nueva contraseña"
          type="password"
          autocomplete="new-password"
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
          Activar cuenta
        </AppButton>
      </form>
    </AppCard>
  </section>
</template>
