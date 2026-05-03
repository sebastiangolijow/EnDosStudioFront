<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppStepper from '@/components/ui/AppStepper.vue'
import UploadDropzone from '@/components/upload/UploadDropzone.vue'
import FilePreview from '@/components/upload/FilePreview.vue'
import { ordersService } from '@/services/orders.service'
import { filesService } from '@/services/files.service'
import { useOrderStore } from '@/stores/order.store'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const orderStore = useOrderStore()
const toast = useToast()

const steps = [
  { number: 1, label: 'Subir diseño' },
  { number: 2, label: 'Editar' },
  { number: 3, label: 'Material y tamaño' },
  { number: 4, label: 'Resumen' },
]

const selectedFile = ref<File | null>(null)
const isUploading = ref(false)

function onFileSelected(file: File) {
  selectedFile.value = file
  // Pre-create the object URL once so FilePreview and any future preview share one.
  // The order.store owns it so it survives navigation (e.g. back button to /upload).
  const url = URL.createObjectURL(file)
  orderStore.setOriginalFile(file, url)
}

function onRemoveFile() {
  selectedFile.value = null
  orderStore.reset()
}

async function onContinue() {
  if (!selectedFile.value) return
  isUploading.value = true
  try {
    // 1. Create empty draft on the backend
    const draft = await ordersService.createDraft()
    orderStore.setCurrent(draft)

    // 2. Upload the original image as the first OrderFile
    await filesService.upload(draft.uuid, 'original', selectedFile.value)

    // 3. Move to /order-config — the customer picks shape, material, size,
    //    qty there. If they keep the default shape (contorneado) and want
    //    to refine the auto-cut, the order-config page surfaces a
    //    "Refinar contorno" button that opens the editor. Geometric shapes
    //    skip the editor entirely.
    router.push({ name: 'order-config', params: { uuid: draft.uuid } })
  } catch (e) {
    // The Axios interceptor handles 401 (refresh + retry, then logout). Any
    // other error reaches us here.
    const detail =
      (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
      'No pudimos subir tu archivo. Intentá de nuevo.'
    toast.error(detail)
  } finally {
    isUploading.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-6 py-10">
    <!-- Stepper -->
    <AppStepper
      :steps="steps"
      :current="1"
      class="mb-10"
    />

    <div class="grid gap-6 md:grid-cols-[1fr_320px]">
      <!-- Left: dropzone OR file preview -->
      <div>
        <UploadDropzone
          v-if="!selectedFile"
          @file-selected="onFileSelected"
        />
        <FilePreview
          v-else
          :file="selectedFile"
          :object-url="orderStore.localOriginalUrl ?? undefined"
          @remove="onRemoveFile"
        />
      </div>

      <!-- Right: tips -->
      <AppCard>
        <h2 class="mb-3 font-semibold text-text">
          Consejos para mejores resultados
        </h2>
        <ul class="flex flex-col gap-2 text-sm text-text-muted">
          <li class="flex gap-2">
            <span
              class="text-success"
              aria-hidden="true"
            >✓</span>
            <span>Fondo transparente o de un solo color.</span>
          </li>
          <li class="flex gap-2">
            <span
              class="text-success"
              aria-hidden="true"
            >✓</span>
            <span>Buena resolución (al menos 1500 px en el lado más largo).</span>
          </li>
          <li class="flex gap-2">
            <span
              class="text-success"
              aria-hidden="true"
            >✓</span>
            <span>Contraste definido entre el diseño y el fondo.</span>
          </li>
        </ul>
      </AppCard>
    </div>

    <!-- Continuar -->
    <div class="mt-8 flex justify-end">
      <AppButton
        size="lg"
        :loading="isUploading"
        :disabled="!selectedFile"
        @click="onContinue"
      >
        Continuar →
      </AppButton>
    </div>
  </section>
</template>
