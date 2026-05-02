<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppStepper from '@/components/ui/AppStepper.vue'
import CanvasStage from '@/components/editor/CanvasStage.vue'
import EditorToolbar from '@/components/editor/EditorToolbar.vue'
import EditorInspector from '@/components/editor/EditorInspector.vue'
import { ordersService } from '@/services/orders.service'
import { filesService } from '@/services/files.service'
import { type AutoCropOptions, useAutoCropWorker } from '@/composables/useAutoCropWorker'
import { useToast } from '@/composables/useToast'
import { type Order, type OrderFile } from '@/types/order'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const steps = [
  { number: 1, label: 'Subir diseño' },
  { number: 2, label: 'Editar' },
  { number: 3, label: 'Material y tamaño' },
  { number: 4, label: 'Resumen' },
]

const orderUuid = computed(() => route.params.uuid as string)

// === State ===
const order = ref<Order | null>(null)
const isLoading = ref<boolean>(true)
const isSaving = ref<boolean>(false)
const noContourMessage = ref<string | null>(null)

const canvasRef = ref<InstanceType<typeof CanvasStage> | null>(null)

const cropOptions = ref<AutoCropOptions>({
  cannyLow: 50,
  cannyHigh: 150,
  blurRadius: 5,
  polyEpsilon: 2,
})
const maskVisible = ref<boolean>(true)

/**
 * Auto-crop runs in a Web Worker. The ~10 MB OpenCV.js WASM compile happens
 * on the worker thread, so the main thread (and the UI) stays responsive
 * while the customer waits for the Auto cut button to enable.
 *
 * `isReady` flips true the moment the worker emits its `ready` message —
 * that's our cue to ungate the toolbar button.
 */
const {
  isReady: openCvReady,
  isProcessing,
  run: runAutoCrop,
  error: autoCropError,
  workerError: openCvError,
  progressMessage,
} = useAutoCropWorker()

// === Image hydration ===

/**
 * Fetch the OrderFile's URL and turn it into an object URL. This sidesteps
 * CORS issues that would taint the canvas when we later cv.imread it —
 * an object URL is same-origin so the canvas stays clean.
 */
async function fetchAsObjectUrl(file: OrderFile): Promise<string> {
  const response = await fetch(file.file)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

// === Auto-crop ===

async function onAutoCut() {
  if (!order.value || !canvasRef.value?.hasImage()) return

  // Pull the image out of the canvas state via a hidden temp Image. We don't
  // expose the HTMLImageElement directly through CanvasStage's ref to keep
  // the encapsulation tight — but we need it to feed the OpenCV pipeline.
  // Cleaner alternative: useAutoCrop accepts a canvas; we'd cv.imread the
  // base layer. But the base canvas has DPR scaling baked in — we want the
  // image at natural resolution. So: keep a copy of the loaded HTMLImageElement.
  if (!loadedImage.value) {
    toast.error('La imagen aún no está lista. Esperá un instante.')
    return
  }

  noContourMessage.value = null
  try {
    const result = await runAutoCrop(loadedImage.value, cropOptions.value)
    if (result.kind === 'no-contour-found') {
      noContourMessage.value =
        'No pudimos detectar un contorno. Probá ajustar los umbrales o subí una foto con más contraste.'
      canvasRef.value.clearMask()
      return
    }
    canvasRef.value.setMask(result.points)
  } catch {
    toast.error('Falló la detección de contorno. Probá de nuevo.')
  }
}

// Keep a copy of the loaded HTMLImageElement so the auto-crop pipeline can
// access pixel data at natural resolution. Populated alongside loadImage.
const loadedImage = ref<HTMLImageElement | null>(null)

// Wrap the canvas's loadImage so we can keep a side-copy of the HTMLImageElement.
async function loadImageIntoEditor(src: string) {
  await canvasRef.value?.loadImage(src)
  // Decode again into a separate Image() — cheap because the bytes are cached
  // by the browser. This gives us the natural-resolution source for OpenCV.
  // Same crossOrigin caveat as in useCanvasEditor.loadImage: blob:/data: URLs
  // must NOT have crossOrigin set, or the browser treats the CORS check as
  // failed against an empty origin and silently kills the load.
  const img = new Image()
  if (!src.startsWith('blob:') && !src.startsWith('data:')) {
    img.crossOrigin = 'anonymous'
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('decode failed'))
    img.src = src
  })
  loadedImage.value = img
}

// === Reactivity: re-run auto-crop on options change (debounced) ===

let optionsTimer: ReturnType<typeof setTimeout> | null = null

watch(cropOptions, () => {
  // Only auto-re-run when we already have a mask — otherwise the customer
  // hasn't asked for it yet.
  if (!canvasRef.value?.hasMask()) return
  if (optionsTimer) clearTimeout(optionsTimer)
  optionsTimer = setTimeout(onAutoCut, 300)
}, { deep: true })

watch(maskVisible, (v) => canvasRef.value?.setMaskVisible(v))

// === Save / Continue ===

async function onContinue() {
  if (!order.value) return
  if (!canvasRef.value?.hasMask()) {
    // No mask is OK — the customer can move on without an auto-crop. The
    // backend just won't have a die_cut_mask file. (Some shops cut on the
    // image's alpha; some require manual curation. M2 doesn't enforce.)
    router.push({ name: 'order-config', params: { uuid: orderUuid.value } })
    return
  }

  isSaving.value = true
  try {
    const blob = await canvasRef.value.getMaskAsBlob()
    if (!blob) {
      router.push({ name: 'order-config', params: { uuid: orderUuid.value } })
      return
    }

    // unique_together(order, kind) on the backend means we have to delete an
    // existing die_cut_mask before re-uploading.
    const existing = order.value.files.find((f) => f.kind === 'die_cut_mask')
    if (existing) {
      await filesService.delete(orderUuid.value, existing.uuid)
    }
    await filesService.upload(orderUuid.value, 'die_cut_mask', blob)

    router.push({ name: 'order-config', params: { uuid: orderUuid.value } })
  } catch {
    toast.error('No pudimos guardar la línea de corte. Intentá de nuevo.')
  } finally {
    isSaving.value = false
  }
}

function onBack() {
  router.push('/upload')
}

// Patch loadOrder to use loadImageIntoEditor instead of canvasRef.loadImage.
// Cleanest way: override the canvas-load step inside loadOrder.
async function bootstrapEditor() {
  isLoading.value = true
  try {
    order.value = await ordersService.retrieve(orderUuid.value)

    if (order.value.status !== 'draft') {
      router.push({ name: 'order-config', params: { uuid: orderUuid.value } })
      return
    }
    const original = order.value.files.find((f) => f.kind === 'original')
    if (!original) {
      toast.error('No hay imagen para editar. Volvé a subir tu diseño.')
      router.push('/upload')
      return
    }

    // Flip isLoading=false BEFORE fetching the image. Why: the editor body
    // (and the CanvasStage inside it) is gated behind `v-if="!isLoading"`,
    // so the canvas component only mounts once isLoading is false. If we
    // tried to push the image into canvasRef.value while isLoading was still
    // true, canvasRef.value would be null and the optional-chained call
    // would silently no-op — the canvas would mount empty and stay empty.
    //
    // The CanvasStage shows its own "Cargando imagen…" overlay while
    // `image` is null, so flipping isLoading early doesn't hide the visual
    // feedback — it just lets the canvas exist in time to receive the image.
    isLoading.value = false
    await nextTick()

    const localUrl = await fetchAsObjectUrl(original)
    await loadImageIntoEditor(localUrl)
  } catch (e) {
    console.error('[editor] bootstrap failed:', e)
    toast.error('No pudimos cargar tu pedido.')
    router.push('/dashboard')
    isLoading.value = false
  }
}

onMounted(bootstrapEditor)
</script>

<template>
  <section class="mx-auto max-w-7xl px-6 py-6">
    <AppStepper
      :steps="steps"
      :current="2"
      class="mb-6"
    />

    <!-- Top bar -->
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <AppButton
          variant="ghost"
          size="sm"
          @click="onBack"
        >
          ← Volver
        </AppButton>
        <h1 class="text-h3 font-bold text-text">
          Editor de sticker
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <AppButton
          variant="secondary"
          size="sm"
          :disabled="isSaving"
        >
          Guardar borrador
        </AppButton>
        <AppButton
          size="sm"
          :loading="isSaving"
          data-testid="editor-continue"
          @click="onContinue"
        >
          Continuar
        </AppButton>
      </div>
    </header>

    <!-- OpenCV-not-loaded warning -->
    <div
      v-if="openCvError"
      class="mb-4 rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error"
    >
      {{ openCvError }}
    </div>

    <!-- Editor body -->
    <div
      v-if="!isLoading"
      class="grid gap-4 lg:grid-cols-[88px_1fr_320px]"
    >
      <!-- Left: toolbar -->
      <EditorToolbar
        :is-processing="isProcessing"
        :is-open-cv-ready="openCvReady"
        @auto-cut="onAutoCut"
      />

      <!-- Center: canvas + status banner -->
      <div class="flex flex-col gap-3">
        <CanvasStage ref="canvasRef" />

        <!-- Auto-crop status banner -->
        <div
          v-if="isProcessing"
          class="rounded-md border border-warning/40 bg-warning/10 p-3 text-center text-sm text-warning"
          data-testid="editor-processing"
        >
          {{ progressMessage || 'Detectando el contorno…' }}
        </div>
        <div
          v-else-if="noContourMessage"
          class="rounded-md border border-warning/40 bg-warning/10 p-3 text-center text-sm text-warning"
          data-testid="editor-no-contour"
        >
          {{ noContourMessage }}
        </div>
        <div
          v-else-if="autoCropError"
          class="rounded-md border border-error/40 bg-error/10 p-3 text-center text-sm text-error"
        >
          {{ autoCropError }}
        </div>
        <div
          v-else-if="!openCvReady"
          class="rounded-md border border-border bg-surface-2 p-3 text-center text-sm text-text-muted"
          data-testid="editor-loading-engine"
        >
          Cargando motor de detección…
          <span class="block text-xs text-text-muted/80">
            La primera carga puede tardar unos segundos. Mientras tanto podés continuar.
          </span>
        </div>
        <div
          v-else
          class="rounded-md border border-border bg-surface-2 p-3 text-center text-sm text-text-muted"
          data-testid="editor-ready"
        >
          Tocá <strong>Auto cut</strong> para detectar el contorno.
        </div>
      </div>

      <!-- Right: inspector -->
      <EditorInspector
        :mask-visible="maskVisible"
        :options="cropOptions"
        @update:mask-visible="maskVisible = $event"
        @update:options="cropOptions = $event"
      />
    </div>

    <div
      v-else
      class="rounded-lg border border-border bg-surface-2 p-12 text-center text-text-muted"
    >
      Cargando editor…
    </div>
  </section>
</template>
