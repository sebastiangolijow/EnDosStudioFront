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
import { getMaskPalette } from '@/utils/materialColors'
import { type Material, type Order, type OrderFile, type Shape } from '@/types/order'

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
  polyEpsilon: 1.5,
  marginMm: 15, // default bleed margin (typical sticker-print convention)
})
const maskVisible = ref<boolean>(true)
// Cut-line smoothing slider value (2–10). Floor is 2 because below that,
// per-vertex normal-offset self-intersections produce visible spikes/loops
// in the cut line — see EditorInspector for the longer rationale.
// Default 3 = subtle smoothing that keeps silhouette detail.
// Persisted only in editor session state for now — the customer's choice
// doesn't ride to the backend (the printed mask matches whatever's on
// screen, so the cutter sees the smoothed shape via the uploaded
// die_cut_mask PNG).
const smoothingSlider = ref<number>(3)
// Show the artwork against the canvas's checker background instead of its
// original (likely white) background. Matches the reference shop's UX —
// once a cut polygon exists, the customer sees what the printed sticker
// will actually look like (no rectangular page bg around it).
const removeBackground = ref<boolean>(true)

// Material + relief + shape state lives in the editor view (not the canvas
// composable) because they're draft-Order properties, not canvas concerns.
// Hydrated from the order on bootstrap, persisted via a debounced PATCH on
// change. Picking these here pre-fills the order-config card grid.
const material = ref<Material | ''>('')
const withRelief = ref<boolean>(false)
const reliefNote = ref<string>('')
const shape = ref<Shape>('contorneado')

/**
 * Generate a geometric polygon (in image-natural coordinates) for the
 * given shape, expanded by `marginPx` on every side. Used when the
 * customer picks cuadrado/circulo/redondeadas — Auto cut doesn't run, but
 * the editor still shows a mask + lets the margin slider adjust the bleed.
 *
 * The margin is baked into the polygon directly (not via the worker's
 * dilate step) because we don't want to spin up the OpenCV pipeline just
 * to enlarge a primitive — this is much faster and matches the same
 * "polygon = final cut line" abstraction the rest of the editor uses.
 *
 * Returns null for `contorneado` (which uses the OpenCV auto-cut output).
 */
function geometricMaskPoints(
  s: Shape,
  imgWidth: number,
  imgHeight: number,
  marginPx: number,
): { kind: 'image'; x: number; y: number }[] | null {
  if (s === 'contorneado') return null
  const m = Math.max(0, marginPx)
  const w = imgWidth + 2 * m
  const h = imgHeight + 2 * m
  // The polygon coordinate system is image-natural, but we want the
  // expanded shape centered on the image. Origin shifts by -m.
  const ox = -m
  const oy = -m

  if (s === 'cuadrado') {
    return [
      { kind: 'image', x: ox, y: oy },
      { kind: 'image', x: ox + w, y: oy },
      { kind: 'image', x: ox + w, y: oy + h },
      { kind: 'image', x: ox, y: oy + h },
    ]
  }
  if (s === 'circulo') {
    // 64-point ellipse — smooth enough to read as a circle at any size.
    const cx = ox + w / 2
    const cy = oy + h / 2
    const rx = w / 2
    const ry = h / 2
    const N = 64
    const points: { kind: 'image'; x: number; y: number }[] = []
    for (let i = 0; i < N; i++) {
      const t = (i / N) * 2 * Math.PI
      points.push({ kind: 'image', x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry })
    }
    return points
  }
  // redondeadas — 4 quarter-circle corners. Corner radius = 10% of the
  // shorter edge of the EXPANDED bbox so the rounding looks proportional.
  const r = Math.min(w, h) * 0.1
  const N_PER_CORNER = 12
  const points: { kind: 'image'; x: number; y: number }[] = []
  const corners: [number, number, number][] = [
    [ox + r, oy + r, Math.PI], // TL
    [ox + w - r, oy + r, 1.5 * Math.PI], // TR
    [ox + w - r, oy + h - r, 0], // BR
    [ox + r, oy + h - r, 0.5 * Math.PI], // BL
  ]
  for (const [cx, cy, startAngle] of corners) {
    for (let i = 0; i <= N_PER_CORNER; i++) {
      const t = startAngle + (i / N_PER_CORNER) * (Math.PI / 2)
      points.push({ kind: 'image', x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r })
    }
  }
  return points
}

/**
 * Convert the customer's marginMm slider value to image-natural pixels
 * using pxPerMm (already computed elsewhere from order.width_mm or the
 * 100mm-long-edge fallback). 0 if scale is unknown.
 */
function marginPxForGeometric(): number {
  const mm = cropOptions.value.marginMm ?? 15
  const pm = pxPerMm.value
  if (!pm || mm <= 0) return 0
  return Math.round(mm * pm)
}

/**
 * Apply the geometric mask for non-contorneado shapes. Called when shape
 * changes, when the image loads, or when marginMm changes.
 */
function applyGeometricMaskIfNeeded() {
  if (!loadedImage.value || !canvasRef.value) return
  const pts = geometricMaskPoints(
    shape.value,
    loadedImage.value.naturalWidth,
    loadedImage.value.naturalHeight,
    marginPxForGeometric(),
  )
  if (pts) {
    canvasRef.value.setMask(pts)
  }
  // contorneado: leave any existing auto-cut mask alone.
}

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

/**
 * Image-natural pixels per mm at print resolution.
 *
 * If the order already has a width chosen on /order-config, we know exactly
 * how many natural pixels map to a millimeter (image_width_px / order_width_mm).
 *
 * Until size is picked we have to guess so the 15 mm margin renders as
 * *something* visible in the editor. Default assumption: the longest image
 * edge will print at 100 mm — typical sticker size. The customer can still
 * tweak the slider; the actual print scale is recomputed when size lands
 * on /order-config and the next Auto cut uses real numbers.
 */
const DEFAULT_LONG_EDGE_MM = 100

const pxPerMm = computed<number | null>(() => {
  if (!loadedImage.value) return null
  const { naturalWidth, naturalHeight } = loadedImage.value
  if (order.value?.width_mm && order.value.width_mm > 0) {
    return naturalWidth / order.value.width_mm
  }
  const longEdge = Math.max(naturalWidth, naturalHeight)
  return longEdge / DEFAULT_LONG_EDGE_MM
})

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
    const result = await runAutoCrop(loadedImage.value, cropOptions.value, {
      pxPerMm: pxPerMm.value,
    })
    if (result.kind === 'no-contour-found') {
      noContourMessage.value =
        'No pudimos detectar un contorno. Probá ajustar los umbrales o subí una foto con más contraste.'
      canvasRef.value.clearMask()
      return
    }
    // Pass the tight artwork polygon too so the canvas can use it as the
    // clip mask when removeBackground is on. Lets the halo show in the
    // bleed margin without the photo's background hiding it.
    canvasRef.value.setMask(result.points, result.artworkPoints ?? null)
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
  if (shape.value !== 'contorneado') {
    // Geometric shapes: just regenerate the primitive polygon at the new
    // margin. Cheap (no OpenCV worker round-trip), so no debounce needed —
    // the slider drag feels instant.
    applyGeometricMaskIfNeeded()
    return
  }
  // contorneado: re-run auto-cut, but only when we already have a mask
  // (otherwise the customer hasn't asked for it yet).
  if (!canvasRef.value?.hasMask()) return
  if (optionsTimer) clearTimeout(optionsTimer)
  optionsTimer = setTimeout(onAutoCut, 300)
}, { deep: true })

watch(maskVisible, (v) => canvasRef.value?.setMaskVisible(v))
watch(removeBackground, (v) => canvasRef.value?.setRemoveBackground(v))
watch(smoothingSlider, (v) => canvasRef.value?.setSmoothingSlider(v))

// === Material + relief: persist to draft, repaint halo ===

// Push the chosen material's palette into the canvas the moment it changes,
// so the halo recolors live (no waiting on a PATCH round-trip). For
// "vinilo transparente" also reduce the base-image opacity so the
// canvas's checker pattern reads through the artwork — same effect the
// reference shop uses to indicate the transparent vinyl finish.
watch(material, (m) => {
  canvasRef.value?.setMaskPalette(getMaskPalette(m))
  canvasRef.value?.setTransparentMaterial(m === 'vinilo_transparente')
  // Material active means a colored halo exists — drop the artwork's
  // alpha slightly so the halo peeks through. "vinilo_transparente"
  // gets its own dedicated treatment via setTransparentMaterial above
  // and shouldn't double-dip on the alpha drop.
  canvasRef.value?.setMaterialActive(m !== '' && m !== 'vinilo_transparente')
})

// Debounced persistence. The customer can flip checkboxes / toggle materials
// rapidly; we coalesce to a single PATCH per ~400 ms idle. We only PATCH
// when any tracked value diverged from the order on disk — first hydrate
// doesn't fire because we set `lastSavedSnapshot` BEFORE the watcher
// activates (after order.value is hydrated).
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSavedSnapshot: {
  material: Material | ''
  withRelief: boolean
  reliefNote: string
  shape: Shape
} | null = null

function maybePersistOrderEdit() {
  if (!order.value) return
  const snap = {
    material: material.value,
    withRelief: withRelief.value,
    reliefNote: reliefNote.value,
    shape: shape.value,
  }
  if (
    lastSavedSnapshot &&
    lastSavedSnapshot.material === snap.material &&
    lastSavedSnapshot.withRelief === snap.withRelief &&
    lastSavedSnapshot.reliefNote === snap.reliefNote &&
    lastSavedSnapshot.shape === snap.shape
  ) {
    return
  }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const updated = await ordersService.update(orderUuid.value, {
        // Only send `material` when set — backend rejects empty strings on
        // material because it's a CharField with choices.
        ...(snap.material ? { material: snap.material } : {}),
        shape: snap.shape,
        with_relief: snap.withRelief,
        relief_note: snap.reliefNote,
      })
      order.value = updated
      lastSavedSnapshot = snap
    } catch {
      toast.error('No pudimos guardar tus cambios. Probá de nuevo.')
    }
  }, 400)
}

watch([material, withRelief, reliefNote, shape], maybePersistOrderEdit)

// When the customer switches shape inside the editor, repaint the mask
// immediately. For geometric shapes that means a new primitive polygon;
// for contorneado, leave whatever auto-cut mask exists alone.
watch(shape, () => applyGeometricMaskIfNeeded())

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

    // Hydrate inspector state from the order BEFORE wiring the persistence
    // watcher's snapshot. Set lastSavedSnapshot first so the watcher's
    // initial fire (from these assignments) is a no-op.
    lastSavedSnapshot = {
      material: order.value.material,
      withRelief: order.value.with_relief,
      reliefNote: order.value.relief_note,
      shape: order.value.shape,
    }
    material.value = order.value.material
    withRelief.value = order.value.with_relief
    reliefNote.value = order.value.relief_note
    shape.value = order.value.shape
    // Push the initial palette into the canvas so a returning customer with
    // a material already chosen sees the right halo color on Auto cut.
    canvasRef.value?.setMaskPalette(getMaskPalette(material.value))
    canvasRef.value?.setTransparentMaterial(material.value === 'vinilo_transparente')
    canvasRef.value?.setMaterialActive(
      material.value !== '' && material.value !== 'vinilo_transparente',
    )
    // Push the bg-removal default so the base layer respects it from the
    // very first paint (otherwise a customer with a pre-existing mask
    // would briefly see the original background before the watcher fires).
    canvasRef.value?.setRemoveBackground(removeBackground.value)

    const localUrl = await fetchAsObjectUrl(original)
    await loadImageIntoEditor(localUrl)
    // For geometric shapes, push the primitive mask now that the image is
    // loaded (we have the natural dimensions to size it against).
    applyGeometricMaskIfNeeded()
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
        :shape="shape"
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
          v-else-if="shape !== 'contorneado'"
          class="rounded-md border border-border bg-surface-2 p-3 text-center text-sm text-text-muted"
          data-testid="editor-shape-fixed"
        >
          Forma <strong>{{ shape }}</strong> aplicada. Ajustá el margen abajo.
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
        :remove-background="removeBackground"
        :options="cropOptions"
        :material="material"
        :shape="shape"
        :with-relief="withRelief"
        :relief-note="reliefNote"
        :smoothing="smoothingSlider"
        @update:mask-visible="maskVisible = $event"
        @update:remove-background="removeBackground = $event"
        @update:options="cropOptions = $event"
        @update:material="material = $event"
        @update:shape="shape = $event"
        @update:with-relief="withRelief = $event"
        @update:relief-note="reliefNote = $event"
        @update:smoothing="smoothingSlider = $event"
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
