<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppCard from '@/components/ui/AppCard.vue'
import { useAuth } from '@/composables/useAuth'

const route = useRoute()
const newPassword1 = ref('')
const newPassword2 = ref('')
const { confirmPasswordReset, status, error } = useAuth()

const uid = computed(() => (route.query.uid as string) ?? '')
const token = computed(() => (route.query.token as string) ?? '')
const validParams = computed(() => !!uid.value && !!token.value)

const passwordsMatch = computed(
  () => newPassword1.value && newPassword1.value === newPassword2.value,
)

function onSubmit() {
  if (!passwordsMatch.value) return
  confirmPasswordReset({
    uid: uid.value,
    token: token.value,
    new_password1: newPassword1.value,
    new_password2: newPassword2.value,
  })
}
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-72px)] max-w-md items-center px-6 py-12">
    <AppCard class="w-full">
      <h1 class="text-h2 font-bold text-text">
        Nueva contraseña
      </h1>

      <div
        v-if="!validParams"
        class="mt-6 rounded-md border border-error/40 bg-error/10 p-4 text-sm text-error"
      >
        Enlace inválido. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".
      </div>

      <form
        v-else
        class="mt-6 flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <AppInput
          v-model="newPassword1"
          label="Nueva contraseña"
          type="password"
          autocomplete="new-password"
          required
          helper="Mínimo 8 caracteres."
        />
        <AppInput
          v-model="newPassword2"
          label="Confirmá la contraseña"
          type="password"
          autocomplete="new-password"
          required
          :error="newPassword2 && !passwordsMatch ? 'Las contraseñas no coinciden.' : ''"
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
          :disabled="!passwordsMatch"
        >
          Guardar contraseña
        </AppButton>
      </form>
    </AppCard>
  </section>
</template>
