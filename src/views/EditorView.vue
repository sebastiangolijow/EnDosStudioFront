<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppStepper from '@/components/ui/AppStepper.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppBottomSheet from '@/components/ui/AppBottomSheet.vue'
import CanvasStage from '@/components/editor/CanvasStage.vue'
import EditorToolbar from '@/components/editor/EditorToolbar.vue'
import EditorInspector from '@/components/editor/EditorInspector.vue'
import UploadDropzone from '@/components/upload/UploadDropzone.vue'
import { ordersService } from '@/services/orders.service'
import { filesService } from '@/services/files.service'
import {
  type AutoCropOptions,
  type ImagePoint,
  useAutoCropWorker,
} from '@/composables/useAutoCropWorker'
import { useToast } from '@/composables/useToast'
import { getMaskPalette } from '@/utils/materialColors'
import { type Material, type Order, type OrderFile, type Shape } from '@/types/order'

const route = useRoute()
const router = useRouter()
const toast = useToast()

// Customer flow is now 3 steps (was 4) — the editor handles both
// upload and design in one screen. Step labels and numbers cascade
// through OrderConfigView (step 2) and CheckoutView (step 3).
const steps = [
  { number: 1, label: 'Diseñar' },
  { number: 2, label: 'Material y tamaño' },
  { number: 3, label: 'Resumen' },
]

const orderUuid = computed(() => route.params.uuid as string)

// "Anonymous editor" mode: the customer hit /editor without a :uuid.
// They have no backend Order yet — every backend mutation is no-op'd,
// the file lives in memory only, and smart-cut goes through the
// IP-rate-limited /orders/smart-cut/ endpoint. Trying to advance past
// the editor (Continuar / "Material y tamaño") opens the auth wall.
const isAnonymousEditor = computed<boolean>(() => !route.params.uuid)

// === State ===
const order = ref<Order | null>(null)
const isLoading = ref<boolean>(true)
const isSaving = ref<boolean>(false)
const noContourMessage = ref<string | null>(null)

// Holds the in-memory File for anonymous mode (no backend OrderFile
// row to read from). Authenticated mode keeps using `order.value.files`
// as before; this ref stays null there.
const anonymousFile = ref<File | null>(null)
// Auth-wall modal trigger. Opens when the anonymous customer clicks
// any "next step" CTA (Continuar / "Material y tamaño") or smart-cut
// when they've already burned their rate limit.
const authWallOpen = ref<boolean>(false)

// Zoom level for the canvas preview — pure CSS scale applied to the
// canvas-stack wrapper. Cycles 1x → 1.5x → 2x → 1x. Doesn't affect
// polygon coordinate math (those live in image-natural pixels), the FX
// shader (its mouse normalization reads getBoundingClientRect which
// reflects the scaled box correctly), or the OpenCV worker (it runs on
// the natural-resolution image side-copy). It's a pure visual aid for
// the customer to inspect cut-line detail.
const zoomLevel = ref<number>(1)
const ZOOM_STEPS = [1, 1.5, 2] as const
function onZoom() {
  const idx = ZOOM_STEPS.indexOf(zoomLevel.value as typeof ZOOM_STEPS[number])
  const next = (idx + 1) % ZOOM_STEPS.length
  zoomLevel.value = ZOOM_STEPS[next]
}

// === Responsive layout ===
//
// The editor body has two layouts:
//   - Desktop (lg+): 3-column grid [toolbar 120 / canvas 1fr / inspector 340]
//   - Mobile (< lg): stacked column with toolbar as horizontal top strip,
//     canvas centered, and inspector in a slide-up bottom sheet triggered
//     by an "Ajustes" button.
//
// We track this via a media-query ref instead of pure Tailwind responsive
// classes because the toolbar and inspector are STATEFUL Vue components —
// rendering two copies (one per breakpoint) would double their lifecycle
// and break the FX layer's GL context attachment. So we render ONE
// instance of each and reposition via v-if.
//
// Tailwind's lg breakpoint is 1024px; matchMedia stays in sync via the
// 'change' listener.
const isDesktop = ref<boolean>(true)
let mql: MediaQueryList | null = null
function syncIsDesktop() {
  if (mql) isDesktop.value = mql.matches
}
onMounted(() => {
  mql = window.matchMedia('(min-width: 1024px)')
  isDesktop.value = mql.matches
  mql.addEventListener('change', syncIsDesktop)
})
onUnmounted(() => {
  if (mql) mql.removeEventListener('change', syncIsDesktop)
})

// Mobile inspector lives in a bottom sheet; this toggles its visibility.
// Closed by default — opens when the customer taps the "Ajustes" button.
const inspectorSheetOpen = ref<boolean>(false)

const canvasRef = ref<InstanceType<typeof CanvasStage> | null>(null)

const cropOptions = ref<AutoCropOptions>({
  cannyLow: 50,
  cannyHigh: 150,
  blurRadius: 5,
  polyEpsilon: 1.5,
  marginMm: 15, // default bleed margin (typical sticker-print convention)
})
const maskVisible = ref<boolean>(true)
// Cut-line smoothing slider value (2–10). For classical Auto cut this
// maps to client-side perimeter-Gaussian render passes; for smart-cut
// it ALSO maps to a server-side binary-mask Gaussian blur (sigma)
// applied before the contour walker — that's what produces a vinyl-
// cuttable line on detailed silhouettes (fur, hair, decoration spikes).
// Default 10 (max) so first-time customers see the smoothest possible
// cut on detailed artwork (fur, hair). Floor is 2 because below that,
// classical Auto cut's per-vertex normal-offset produces self-
// intersection spikes — irrelevant for smart-cut but the shared
// slider stays consistent.
const smoothingSlider = ref<number>(10)
// "Quitar fondo" defaults OFF — the editor preview shows the customer's
// source image edge-to-edge inside the cut polygon (smart-cut bleed
// background extends outward visibly). The customer opts in to clipping
// the base to the tight artwork silhouette when they want to preview
// the material halo in the bleed margin. This matches the reference
// shop's default behavior and is what makes the holographic / fluorescent
// FX read against the original-image-background ground instead of the
// checker.
const removeBackground = ref<boolean>(false)

// Material + relief + shape state lives in the editor view (not the canvas
// composable) because they're draft-Order properties, not canvas concerns.
// Hydrated from the order on bootstrap, persisted via a debounced PATCH on
// change. Picking these here pre-fills the order-config card grid.
const material = ref<Material | ''>('')
const withRelief = ref<boolean>(false)
const reliefNote = ref<string>('')
const shape = ref<Shape>('contorneado')
// Drag offset for geometric shapes, in image-natural pixels. Lets the
// customer reposition cuadrado / circulo / oval / redondeadas around
// off-center artwork by dragging the mask. Reset on shape change and
// on Borrar.
const shapeOffset = ref<{ x: number; y: number }>({ x: 0, y: 0 })

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
  offsetXPx = 0,
  offsetYPx = 0,
): { kind: 'image'; x: number; y: number }[] | null {
  if (s === 'contorneado') return null
  // Negative margins are allowed for geometric shapes — the customer
  // can crop INTO the artwork (e.g. cut off the edge of a logo). The
  // print shop accepts this because the user explicitly drew the cut
  // line where they want it. Floor at -half the image dimension to
  // avoid degenerate (zero-or-negative-size) polygons.
  const maxInsetX = imgWidth * 0.45  // never collapse below ~10% of the image
  const maxInsetY = imgHeight * 0.45
  const maxInset = Math.min(maxInsetX, maxInsetY)
  const m = Math.max(-maxInset, marginPx)
  const w = imgWidth + 2 * m
  const h = imgHeight + 2 * m
  // The polygon coordinate system is image-natural, but we want the
  // expanded shape centered on the image. Origin shifts by -m, then
  // by the customer's drag offset (image-natural pixels).
  const ox = -m + offsetXPx
  const oy = -m + offsetYPx

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
  if (s === 'oval') {
    // Wide oval — fixed 2:1 horizontal aspect regardless of source
    // image dimensions. Reads as a deliberate "ID badge" / "racetrack"
    // shape that's visually distinct from circulo (which fits to the
    // image's natural aspect). Sized to the LONGER edge of the image
    // so it sits within the customer's design like a frame.
    const longEdge = Math.max(imgWidth, imgHeight)
    // Half-axes in image-natural pixels, then add the margin.
    const baseRx = longEdge / 2
    const baseRy = baseRx / 2  // 2:1 aspect
    const rx = baseRx + m
    const ry = baseRy + m
    // Center on the image's bounding box (+ customer drag offset).
    const cx = imgWidth / 2 + offsetXPx
    const cy = imgHeight / 2 + offsetYPx
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
  if (!pm) return 0
  // Negative margins are intentional for geometric shapes (the
  // customer wants to crop into the artwork). Keep the sign through
  // the conversion; geometricMaskPoints handles the bottom clamp.
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
    shapeOffset.value.x,
    shapeOffset.value.y,
  )
  if (pts) {
    // If we were in smart-cut mode, the canvas base layer is the cleaned
    // RGBA — but geometric shapes ignore artwork silhouette and want the
    // original unaltered image so the customer sees the full photo
    // inside the square/circle/etc. Restore before applying.
    if (cutMode.value === 'smart') {
      // Fire-and-forget: restoreOriginalBaseImage is async (Image decode)
      // but the geometric mask doesn't depend on the new pixels being
      // ready, so we don't await — it'll repaint once the swap completes.
      void restoreOriginalBaseImage()
    }
    canvasRef.value.setMask(pts)
    // Geometric shapes don't have a "cut mode" — neither classical
    // OpenCV nor smart-cut produced this polygon; it's a primitive.
    // Clear smart-cut state so a future shape switch back to
    // contorneado doesn't accidentally re-offset stale data.
    cutMode.value = null
    smartCutTightPoints.value = null
  }
  // contorneado: leave any existing auto-cut mask alone.
}

/**
 * Pointer-down on the canvas. For geometric shapes, start a drag that
 * translates the cut polygon by the pointer's delta (in image-natural
 * pixels). The composable handles the canvas-px → image-px math via
 * the fit transform; we just consume the running delta and feed it
 * into shapeOffset, then call applyGeometricMaskIfNeeded to repaint.
 *
 * Contorneado doesn't participate — its mask comes from Auto cut /
 * Smart cut, not a translatable primitive.
 */
function onCanvasPointerDown(e: PointerEvent) {
  if (!canvasRef.value) return
  if (shape.value === 'contorneado') return
  if (!canvasRef.value.hasMask()) return
  // Anchor the drag at the current offset and accumulate the delta
  // into it for each pointermove. This way the polygon follows the
  // cursor smoothly without jumping when the customer presses down.
  const anchorOffset = { ...shapeOffset.value }
  canvasRef.value.beginPointerDrag(
    e,
    ({ dx, dy }: { dx: number; dy: number }) => {
      shapeOffset.value = {
        x: anchorOffset.x + dx,
        y: anchorOffset.y + dy,
      }
      applyGeometricMaskIfNeeded()
    },
    // No onEnd callback needed — the debounced PATCH watch already
    // persists the offset through the standard order-update flow
    // (well, it would if shapeOffset were a persisted field — it
    // isn't today; the offset is editor-session-only state).
  )
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

// Smart-cut state. Independent of OpenCV.js — the work runs server-side
// (rembg AI background removal). Customer-blocking: ~3-5 s round-trip
// including model inference. We surface progress via the same banner
// the classical auto-cut uses (`editor-processing`).
const isSmartCutting = ref<boolean>(false)

// Which cut pipeline produced the current polygon. Drives:
//   - whether the margin slider re-runs OpenCV (auto) or just re-offsets
//     the saved tight polygon (smart);
//   - whether Auto cut is disabled (smart locks it out — clicking it would
//     overwrite the AI result with the classical one, which is rarely
//     what the customer wants).
// `null` = no cut applied yet.
const cutMode = ref<'auto' | 'smart' | null>(null)

// True once the customer has committed to a shape:
//   - geometric shapes (cuadrado/circulo/redondeadas) apply a primitive
//     polygon immediately on click → mask is active the moment they pick
//   - contorneado is the default; it stays "uncommitted" until Auto cut
//     or Smart cut produces a real cut polygon → cutMode flips off null
// Drives the inspector's shape-button locking — switching shape→shape
// directly without Borrar in between was producing visible glitches
// (the new mask painted on top of stale state from the previous shape).
const hasActiveMask = computed<boolean>(
  () => shape.value !== 'contorneado' || cutMode.value !== null,
)

// Tight artwork polygon from the last smart-cut, in image-natural pixels.
// Saved so the canvas can keep using it as the artwork-clip for halo
// rendering after the polygon updates from a margin-slider re-call.
// Cleared when classical Auto cut runs (the customer switched modes
// back) or when shape changes.
const smartCutTightPoints = ref<ImagePoint[] | null>(null)

// Print-shop printable-margin floor, in millimeters. Mirrors backend
// MIN_MARGIN_MM in services_smart_cut.py. Below this die-cut tolerance
// alone consumes the margin and the artwork gets clipped at the edge.
const SMART_CUT_MIN_MARGIN_MM = 5

// Default smart-cut margin on first run. Matches the editor's classical
// Auto cut default — customer sees a sane bleed without having to drag
// the slider.
const SMART_CUT_DEFAULT_MARGIN_MM = 15

// Source URL of the customer's ORIGINAL uploaded image. Saved so that
// when smart-cut runs (which swaps the canvas base layer to the
// rembg-cleaned RGBA), we can restore the original on classical Auto
// cut, shape change, or any "exit smart-cut mode" path. The cleaned
// image and the original have identical pixel dimensions, so all
// coordinate math (pxPerMm, fit transform, polygon offsets) keeps
// working unchanged across the swap.
const originalImageSrc = ref<string | null>(null)

// ============================================================
// Undo / Redo (Model A: checkpoint-based history)
// ============================================================
//
// Snapshots capture meaningful editor state at "decision points":
// after Auto cut, after smart-cut, on shape/material/relief/Quitar-fondo
// change, on Borrar. Slider drags (margin, smoothing) and free-text
// inputs (reliefNote) do NOT push checkpoints — they ride within the
// current undo step.
//
// Stack discipline: pushCheckpoint captures the CURRENT (pre-mutation)
// state, then the caller mutates. Undo pops, swaps current → redoStack,
// applies the popped snapshot.
//
// The `restoring` flag suppresses reactive checkpoint-watchers during
// an undo/redo apply so the restore itself doesn't push a new snapshot
// (which would corrupt the stack and prevent further undos).
interface EditorSnapshot {
  /** Image src (may be the original PNG URL, or a smart-cut data: URL
   *  if the customer was in smart-cut mode at this checkpoint). */
  imageSrc: string | null
  /** Cut polygon — read out of useCanvasEditor via the canvas ref. */
  maskPoints: ImagePoint[] | null
  /** Tight artwork polygon (smart-cut only; null for classical Auto cut
   *  and geometric shapes). */
  artworkPoints: ImagePoint[] | null
  cutMode: 'auto' | 'smart' | null
  smartCutTightPoints: ImagePoint[] | null
  // Draft-order fields
  shape: Shape
  material: Material | ''
  withRelief: boolean
  reliefNote: string
  // View / clipping
  removeBackground: boolean
  // Sliders — included because Borrar resets them; preserved across
  // checkpoints that DON'T change them (we just copy current values).
  marginMm: number
  smoothingSlider: number
}

const undoStack = ref<EditorSnapshot[]>([])
const redoStack = ref<EditorSnapshot[]>([])
const HISTORY_LIMIT = 50
/** True while applySnapshot is running. Reactive watchers that
 *  normally push a checkpoint should bail when this is set. */
const restoring = ref<boolean>(false)

function captureSnapshot(): EditorSnapshot {
  return {
    imageSrc: loadedImage.value?.src ?? originalImageSrc.value,
    maskPoints: canvasRef.value?.getMaskPoints() ?? null,
    artworkPoints: canvasRef.value?.getArtworkPoints() ?? null,
    cutMode: cutMode.value,
    smartCutTightPoints: smartCutTightPoints.value
      ? smartCutTightPoints.value.map((p) => ({ kind: 'image' as const, x: p.x, y: p.y }))
      : null,
    shape: shape.value,
    material: material.value,
    withRelief: withRelief.value,
    reliefNote: reliefNote.value,
    removeBackground: removeBackground.value,
    marginMm: cropOptions.value.marginMm ?? 15,
    smoothingSlider: smoothingSlider.value,
  }
}

function pushCheckpoint() {
  if (restoring.value) return
  undoStack.value.push(captureSnapshot())
  // A new action invalidates the redo branch — once the customer takes
  // a different path, "forward" no longer makes sense.
  redoStack.value = []
  if (undoStack.value.length > HISTORY_LIMIT) {
    undoStack.value.shift()
  }
}

/** Monotonic id incremented on every "context-shift" action (undo, redo,
 *  Borrar). Long-running operations (smart-cut request, Auto cut worker
 *  run) capture this id before await; on resolve they compare and drop
 *  their result if the id has changed — prevents a stale smart-cut
 *  response from overwriting state the customer just rewound past. */
const cutGenerationId = ref<number>(0)

async function applySnapshot(s: EditorSnapshot) {
  if (!canvasRef.value) return
  restoring.value = true
  // Bump the generation id so any in-flight smart-cut / Auto cut
  // resolves into a no-op.
  cutGenerationId.value++
  try {
    // Image — reload only if it changed (avoid an expensive re-decode
    // when the snapshot keeps the same source).
    const currentSrc = loadedImage.value?.src ?? originalImageSrc.value
    if (s.imageSrc && s.imageSrc !== currentSrc) {
      await canvasRef.value.loadImage(s.imageSrc)
      const img = new Image()
      if (!s.imageSrc.startsWith('blob:') && !s.imageSrc.startsWith('data:')) {
        img.crossOrigin = 'anonymous'
      }
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('decode failed'))
        img.src = s.imageSrc as string
      })
      loadedImage.value = img
    }
    // Cut state
    if (s.maskPoints) {
      canvasRef.value.setMask(s.maskPoints, s.artworkPoints)
    } else {
      canvasRef.value.clearMask()
    }
    cutMode.value = s.cutMode
    smartCutTightPoints.value = s.smartCutTightPoints
      ? s.smartCutTightPoints.map((p) => ({ kind: 'image' as const, x: p.x, y: p.y }))
      : null
    // Draft order
    shape.value = s.shape
    material.value = s.material
    withRelief.value = s.withRelief
    reliefNote.value = s.reliefNote
    // View
    removeBackground.value = s.removeBackground
    canvasRef.value.setRemoveBackground(s.removeBackground)
    // Sliders — assign via spread so the cropOptions watcher fires
    // (downstream consumers track the object reference).
    cropOptions.value = {
      ...cropOptions.value,
      marginMm: s.marginMm,
    }
    smoothingSlider.value = s.smoothingSlider
    noContourMessage.value = null
  } finally {
    // Let the dust settle (one tick) before re-enabling checkpoints —
    // some restore-triggered watchers fire on the next microtask and
    // shouldn't push.
    await nextTick()
    restoring.value = false
  }
}

async function onUndo() {
  if (undoStack.value.length === 0) return
  const snapshot = undoStack.value.pop() as EditorSnapshot
  redoStack.value.push(captureSnapshot())
  await applySnapshot(snapshot)
}

async function onRedo() {
  if (redoStack.value.length === 0) return
  const snapshot = redoStack.value.pop() as EditorSnapshot
  undoStack.value.push(captureSnapshot())
  await applySnapshot(snapshot)
}

const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)

/**
 * Inspector emits a change for a checkpoint-relevant field. Push the
 * current (pre-change) state to the undo stack, then mutate.
 *
 * Skipped if the new value equals the current one (idempotent emits from
 * the inspector — e.g. clicking the already-selected card — would
 * otherwise corrupt the stack with identical snapshots).
 *
 * Skipped during restore: applySnapshot sets these refs imperatively;
 * the inspector's reactive bindings would re-emit, triggering this
 * handler, and a checkpoint would land mid-restore. The `restoring`
 * flag inside pushCheckpoint already prevents the push, but bailing
 * here avoids the dead-code path entirely.
 */
function onInspectorChange<K extends 'shape' | 'material' | 'withRelief' | 'removeBackground'>(
  field: K,
  value: K extends 'shape'
    ? Shape
    : K extends 'material'
      ? Material | ''
      : boolean,
) {
  if (restoring.value) return
  // Equality short-circuit — don't push for no-op changes.
  if (field === 'shape' && shape.value === value) return
  if (field === 'material' && material.value === value) return
  if (field === 'withRelief' && withRelief.value === value) return
  if (field === 'removeBackground' && removeBackground.value === value) return

  pushCheckpoint()
  if (field === 'shape') shape.value = value as Shape
  else if (field === 'material') material.value = value as Material | ''
  else if (field === 'withRelief') withRelief.value = value as boolean
  else if (field === 'removeBackground') removeBackground.value = value as boolean
}

const hasOriginalFile = computed<boolean>(() => {
  // Anonymous mode reads the in-memory File ref; authenticated reads
  // the order's file list. Either path indicates "the editor canvas
  // has an image to render".
  if (isAnonymousEditor.value) return anonymousFile.value !== null
  // Optional-chain `files` too: there's a brief reactivity gap during
  // smart-cut where order.value is set but order.value.files might be
  // undefined (the response splice fires before Vue patches the array).
  // Without this guard, `.some` blows up and Vue surfaces it as a hard
  // "Unhandled error during execution of component update" toast.
  return order.value?.files?.some((f) => f.kind === 'original') ?? false
})

/**
 * Run smart-cut against the backend. The backend dilates the rembg-cleaned
 * alpha mask by `marginMm` of bleed and Gaussian-smooths it by `smoothness`
 * before tracing the contour, so the polygon we receive is already
 * inflated, smoothed, and a vinyl plotter can physically follow it.
 *
 * Called on the initial Smart cut button click AND on margin/smoothness
 * slider changes while in smart-cut mode. The `editor-processing` banner
 * reflects the in-flight request via `isSmartCutting`.
 */
async function runSmartCut(marginMm: number, smoothness: number) {
  if (!canvasRef.value) return
  // Auth: anonymous mode needs the in-memory File; authed mode needs an Order.
  if (isAnonymousEditor.value && !anonymousFile.value) return
  if (!isAnonymousEditor.value && !order.value) return

  // Floor at the printable minimum; backend also clamps but we want the
  // local state in sync with what the server actually used.
  const effectiveMargin = Math.max(SMART_CUT_MIN_MARGIN_MM, Math.round(marginMm))
  const effectiveSmoothness = Math.max(1, Math.min(10, Math.round(smoothness)))

  // Capture the current generation id so a late response after an undo/
  // redo/Borrar doesn't overwrite state the customer just rewound past.
  const generationAtStart = cutGenerationId.value
  noContourMessage.value = null
  isSmartCutting.value = true
  try {
    const result = isAnonymousEditor.value
      ? await ordersService.smartCutAnonymous(
          anonymousFile.value!,
          effectiveMargin,
          effectiveSmoothness,
        )
      : await ordersService.smartCut(
          order.value!.uuid,
          effectiveMargin,
          effectiveSmoothness,
        )
    // Stale response — customer changed editor context while the request
    // was in flight. Drop silently; the new context already has the right
    // state.
    if (generationAtStart !== cutGenerationId.value) return
    if (result.kind === 'no-contour-found') {
      noContourMessage.value =
        'No pudimos detectar el contorno automáticamente. Probá con otra imagen o usá Auto cut.'
      canvasRef.value.clearMask()
      cutMode.value = null
      smartCutTightPoints.value = null
      return
    }
    // Defensive: confirm the polygon arrays look right before we touch
    // the canvas. A backend deploy that drops `points` from the response
    // must surface as a clean error, not a cryptic .map / .length crash.
    const cutPolygon: ImagePoint[] = Array.isArray(result.points) ? result.points : []
    const tightPolygon: ImagePoint[] = Array.isArray(result.artwork_points)
      ? result.artwork_points
      : []
    if (cutPolygon.length < 3) {
      throw new Error(
        `[smart-cut] backend returned no usable polygon (points=${cutPolygon.length})`,
      )
    }

    // Swap the canvas base layer to the cleaned RGBA. Same pixel dims as
    // the original so coordinate math survives. The backend paints the
    // bleed ring with the ORIGINAL source RGB pixels (not transparent),
    // so a photo of a logo on teal shows teal extending outward — exactly
    // what the print shop expects to see on a bleed margin.
    //
    // Important: DO NOT decode the data URL twice in rapid succession.
    // We were doing canvasRef.loadImage(url) then a second `new Image()`
    // .src = url for the OpenCV side-copy. Browsers serialize image
    // decodes per-source, and on a 500+ KB data URL the second decode
    // can race / time out, surfacing as a generic onerror in the catch
    // block (the toast we saw). One decode → reuse the HTMLImageElement.
    if (result.cleaned_image_data_url) {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('cleaned-image decode failed'))
        img.src = result.cleaned_image_data_url!
      })
      // Push the already-decoded image into the canvas + the OpenCV
      // side-copy. CanvasStage's loadImage takes a src string and
      // re-decodes; for that path we still need a URL, but the second
      // decode hits the data: scheme cache so it's nearly free.
      await canvasRef.value.loadImage(result.cleaned_image_data_url)
      loadedImage.value = img
    }
    smartCutTightPoints.value = tightPolygon
    cutMode.value = 'smart'
    canvasRef.value.setMask(cutPolygon, tightPolygon)
  } catch (e) {
    console.error('[smart-cut] failed:', e)
    const status = (e as { response?: { status?: number } }).response?.status
    if (status === 429) {
      // Anonymous rate limit (5/hour per IP). Push register CTA.
      toast.error(
        'Llegaste al límite de Recorte inteligente. Creá una cuenta gratuita para usarlo sin límites.',
      )
      authWallOpen.value = true
    } else if (status === 503) {
      toast.error('El recorte inteligente no está disponible. Intentá Auto cut.')
    } else if (status === 400) {
      toast.error('Subí tu diseño antes de usar Recorte inteligente.')
    } else {
      toast.error('Falló el recorte inteligente. Probá de nuevo.')
    }
  } finally {
    isSmartCutting.value = false
  }
}

/**
 * Smart cut button handler. Bumps the margin slider to the default if it's
 * still at 0 (or below the printable floor) so first-time customers see a
 * sane bleed without having to discover the slider.
 */
async function onSmartCut() {
  // Checkpoint the pre-smart-cut state so the customer can undo back to it.
  // The slider-driven re-call sites use runSmartCut directly — no checkpoint
  // there, since the customer is iterating within the same decision.
  pushCheckpoint()
  const current = cropOptions.value.marginMm ?? 0
  const margin =
    current < SMART_CUT_MIN_MARGIN_MM ? SMART_CUT_DEFAULT_MARGIN_MM : current
  cropOptions.value = { ...cropOptions.value, marginMm: margin }
  await runSmartCut(margin, smoothingSlider.value)
}

/**
 * Swap the canvas base layer back to the customer's ORIGINAL uploaded
 * image. Called when leaving smart-cut mode (classical Auto cut, shape
 * change away from contorneado) — the cleaned RGBA was a temporary
 * preview and shouldn't persist into other modes.
 */
async function restoreOriginalBaseImage() {
  const src = originalImageSrc.value
  if (!src || !canvasRef.value) return
  await canvasRef.value.loadImage(src)
  // Re-decode for the OpenCV side-copy too (cheap; bytes are cached).
  const img = new Image()
  if (!src.startsWith('blob:') && !src.startsWith('data:')) {
    img.crossOrigin = 'anonymous'
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('original re-decode failed'))
    img.src = src
  })
  loadedImage.value = img
}

// (Smart-cut polygon expansion is now done backend-side via PIL MaxFilter
// dilation — see services_smart_cut.py. The previous JS-side
// offsetPolygonOutward + smoothPolygonPerimeter pipeline produced
// self-intersecting polygons on non-convex silhouettes at large margin
// values, because per-vertex normal-bisector offset is mathematically
// incorrect for concave shapes. PIL's MaxFilter is a true Minkowski-sum
// dilation on the binary mask and always yields a simple polygon.)

async function onAutoCut(opts: { fromToolbar?: boolean } = { fromToolbar: true }) {
  if (!order.value || !canvasRef.value?.hasImage()) return

  // Checkpoint only when the customer clicked the toolbar. Slider-driven
  // re-runs (via the cropOptions watcher) iterate within the same
  // checkpoint — no need to flood the undo stack with one entry per
  // slider tick.
  if (opts.fromToolbar) pushCheckpoint()

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

  // If we were in smart-cut mode, the canvas base layer is the cleaned
  // RGBA. Classical OpenCV detection runs against the ORIGINAL pixels
  // (the customer wants to detect from the unaltered photo, not from
  // rembg's already-cleaned silhouette). Restore the original first.
  if (cutMode.value === 'smart') {
    await restoreOriginalBaseImage()
  }

  const generationAtStart = cutGenerationId.value
  noContourMessage.value = null
  try {
    const result = await runAutoCrop(loadedImage.value, cropOptions.value, {
      pxPerMm: pxPerMm.value,
    })
    // Stale response — customer changed editor context (undo/redo/Borrar)
    // while OpenCV was running. Drop silently.
    if (generationAtStart !== cutGenerationId.value) return
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
    // Classical auto-cut overrides any prior smart-cut state. Forget the
    // saved smart-cut tight polygon so a future margin change uses the
    // OpenCV pipeline, not a local re-offset of stale data.
    cutMode.value = 'auto'
    smartCutTightPoints.value = null
  } catch {
    toast.error('Falló la detección de contorno. Probá de nuevo.')
  }
}

/**
 * Reset the editor to the state it was in immediately after the customer's
 * image first loaded. Triggered by the toolbar's "Borrar" button.
 *
 * Restores:
 *   - the ORIGINAL image (if smart-cut had swapped in a cleaned RGBA)
 *   - no cut mask (clearMask)
 *   - default shape (contorneado), material (none), relief off
 *   - default sliders (margin 15 mm, smoothing 6)
 *   - Quitar fondo off
 *   - cut mode + smart-cut state cleared
 *
 * Does NOT delete the backend draft order — the customer can just pick
 * Auto cut / Recorte inteligente again and continue. Saving these reset
 * values to the order happens via the usual debounced PATCH watch.
 */
async function onReset() {
  if (!canvasRef.value) return
  // Checkpoint the current state — "wait, I didn't mean Borrar" → undo
  // takes the customer back. Bump generation id so any in-flight cut
  // operation doesn't overwrite the reset state.
  pushCheckpoint()
  cutGenerationId.value++
  // Restore the original image first so subsequent state resets apply
  // against the right pixels. originalImageSrc is populated on the first
  // loadImageIntoEditor call (which the bootstrap fires).
  if (originalImageSrc.value) {
    try {
      await canvasRef.value.loadImage(originalImageSrc.value)
      // Re-decode the side-copy used by OpenCV.
      const img = new Image()
      if (
        !originalImageSrc.value.startsWith('blob:') &&
        !originalImageSrc.value.startsWith('data:')
      ) {
        img.crossOrigin = 'anonymous'
      }
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('decode failed'))
        img.src = originalImageSrc.value as string
      })
      loadedImage.value = img
    } catch {
      // If reload fails, leave the current canvas state — the rest of the
      // reset still happens so the customer can recover by re-uploading.
      toast.error('No pudimos restaurar la imagen original.')
    }
  }
  // Canvas state
  canvasRef.value.clearMask()
  canvasRef.value.setRemoveBackground(false)
  // Editor state
  shape.value = 'contorneado'
  material.value = ''
  withRelief.value = false
  reliefNote.value = ''
  removeBackground.value = false
  cropOptions.value = {
    ...cropOptions.value,
    marginMm: 15,
  }
  smoothingSlider.value = 10
  // Cut-pipeline state
  cutMode.value = null
  smartCutTightPoints.value = null
  noContourMessage.value = null
  // Drag offset for geometric shapes — back to centered.
  shapeOffset.value = { x: 0, y: 0 }
}

// Keep a copy of the loaded HTMLImageElement so the auto-crop pipeline can
// access pixel data at natural resolution. Populated alongside loadImage.
const loadedImage = ref<HTMLImageElement | null>(null)

// Wrap the canvas's loadImage so we can keep a side-copy of the HTMLImageElement.
async function loadImageIntoEditor(src: string) {
  // Remember the very first src as the "original". Subsequent calls
  // (e.g. swapping in the cleaned RGBA after smart-cut) don't override
  // this — only the initial bootstrap does, plus an explicit reset.
  if (originalImageSrc.value === null) {
    originalImageSrc.value = src
  }
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
// Smart-cut margin debounce is longer than the classical-auto debounce
// because each smart-cut call costs ~0.5-3 s server-side (rembg + dilate +
// PNG encode). 600 ms gives the customer time to scrub the slider without
// firing a request mid-drag, while still feeling responsive once they
// settle on a value.
const SMART_CUT_DEBOUNCE_MS = 600

watch(cropOptions, () => {
  if (shape.value !== 'contorneado') {
    // Geometric shapes: just regenerate the primitive polygon at the new
    // margin. Cheap (no OpenCV worker round-trip), so no debounce needed —
    // the slider drag feels instant.
    applyGeometricMaskIfNeeded()
    return
  }
  // contorneado branches by which pipeline produced the current polygon.
  if (!canvasRef.value?.hasMask()) return
  if (cutMode.value === 'smart') {
    // Smart cut: re-call the backend with the new margin. Backend dilates
    // the rembg-cleaned alpha and traces a fresh contour — clean simple
    // polygon at any margin. Debounced longer than classical auto-cut
    // because each call is a server roundtrip.
    if (optionsTimer) clearTimeout(optionsTimer)
    const margin = cropOptions.value.marginMm ?? SMART_CUT_DEFAULT_MARGIN_MM
    optionsTimer = setTimeout(
      () => runSmartCut(margin, smoothingSlider.value),
      SMART_CUT_DEBOUNCE_MS,
    )
    return
  }
  // Classical auto-cut: debounce + re-run OpenCV with the new options.
  if (optionsTimer) clearTimeout(optionsTimer)
  optionsTimer = setTimeout(() => onAutoCut({ fromToolbar: false }), 300)
}, { deep: true })

watch(maskVisible, (v) => canvasRef.value?.setMaskVisible(v))
watch(removeBackground, (v) => canvasRef.value?.setRemoveBackground(v))

// Smoothing slider has dual meaning by cut mode:
//   - Classical Auto cut: client-side perimeter-Gaussian render smoothing
//     (the canvas redraws with the new smoothed polygon). Cheap, instant.
//   - Smart cut: ALSO re-calls the backend so the cut polygon itself is
//     smoothed at the source (binary-mask Gaussian blur before contour
//     walk). The mask-blur path is what produces a vinyl-cuttable line —
//     client-side smoothing alone can't fill deep silhouette concavities.
// Same 600 ms debounce as the margin slider so quick scrubbing doesn't
// fire a request per tick.
watch(smoothingSlider, (v) => {
  canvasRef.value?.setSmoothingSlider(v)
  if (cutMode.value === 'smart' && shape.value === 'contorneado') {
    if (optionsTimer) clearTimeout(optionsTimer)
    const margin = cropOptions.value.marginMm ?? SMART_CUT_DEFAULT_MARGIN_MM
    optionsTimer = setTimeout(
      () => runSmartCut(margin, v),
      SMART_CUT_DEBOUNCE_MS,
    )
  }
})

// === Material + relief: persist to draft, repaint halo ===

// Push the chosen material's palette into the canvas the moment it changes,
// so the halo recolors live (no waiting on a PATCH round-trip). For
// "vinilo transparente" also reduce the base-image opacity so the
// canvas's checker pattern reads through the artwork — same effect the
// reference shop uses to indicate the transparent vinyl finish.
/** Map the customer's chosen material to a WebGL FX mode. The FX layer
 *  paints over the artwork + bleed; bleed-halo color is owned separately
 *  by the mask layer and read from MATERIAL_TEXTURE_URLS.
 *
 *  - holografico              → cool foil, sharp iridescent bands
 *  - holografico_transparente → cool foil with stronger artwork-interior
 *                              reflections (no opaque white backing)
 *  - eggshell_holografico     → warm pastel foil, broad soft bands
 *                              (paper-printed feel; halo is eggshell)
 *  - luminiscente             → phosphorescent greenish-yellow glow
 *                              concentrated at the cut edge
 *  - plateado                 → neutral metallic chrome (silver) — white
 *                              ink reads as bright silver, colored ink
 *                              keeps its hue with chrome sheen on the
 *                              sweep bands
 *  - dorado                   → warm metallic gold — white ink reads as
 *                              bright gold, colored ink keeps its hue
 *                              with warm sheen on the sweep bands
 *  - everything else          → no FX overlay; mask halo + base image
 *                              are sufficient
 */
function effectModeFor(
  m: Material | '',
):
  | 'holographic'
  | 'holographic_transparent'
  | 'luminescent'
  | 'eggshell_holographic'
  | 'silver'
  | 'gold'
  | null {
  if (m === 'holografico') return 'holographic'
  if (m === 'holografico_transparente') return 'holographic_transparent'
  if (m === 'eggshell_holografico') return 'eggshell_holographic'
  if (m === 'luminiscente') return 'luminescent'
  if (m === 'plateado') return 'silver'
  if (m === 'dorado') return 'gold'
  return null
}

watch(material, (m) => {
  canvasRef.value?.setMaskPalette(getMaskPalette(m))
  // Transparent vinyl OR transparent holographic both want the canvas
  // checker showing through the artwork. The FX shader handles the
  // holographic-transparent case (it boosts artwork-interior alpha so
  // the checker reads through); plain vinilo_transparente uses the
  // existing 2D base-layer alpha drop.
  canvasRef.value?.setTransparentMaterial(m === 'vinilo_transparente')
  // Material active = a colored halo exists. Used to gate halo-dependent
  // tweaks in drawBaseLayer / drawMaskLayer. "vinilo_transparente" gets
  // its own dedicated treatment via setTransparentMaterial above.
  canvasRef.value?.setMaterialActive(m !== '' && m !== 'vinilo_transparente')
  // Legacy boolean — kept for the (now-empty) drawBaseLayer branch that
  // used to call drawHolographicOverlay. The WebGL FX layer is the
  // canonical holographic renderer; this just keeps state consistent.
  canvasRef.value?.setHolographicMaterial(
    m === 'holografico' || m === 'holografico_transparente',
  )
  // The actual per-material visual: WebGL FX mode.
  canvasRef.value?.setEffectMode(effectModeFor(m))
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

/**
 * Persist the draft-order fields (material, shape, relief). Returns the
 * snapshot it sent so callers can compare against subsequent state. Used
 * both by the debounced autosave path and by the explicit "Guardar
 * borrador" button (which flushes any pending debounce and PATCHes
 * immediately).
 */
async function patchDraftFields(): Promise<typeof lastSavedSnapshot> {
  if (!order.value) return lastSavedSnapshot
  const snap = {
    material: material.value,
    withRelief: withRelief.value,
    reliefNote: reliefNote.value,
    shape: shape.value,
  }
  // Nothing changed since the last successful save — skip the request.
  if (
    lastSavedSnapshot &&
    lastSavedSnapshot.material === snap.material &&
    lastSavedSnapshot.withRelief === snap.withRelief &&
    lastSavedSnapshot.reliefNote === snap.reliefNote &&
    lastSavedSnapshot.shape === snap.shape
  ) {
    return lastSavedSnapshot
  }
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
  return snap
}

function maybePersistOrderEdit() {
  // Anonymous mode: no order to patch. The watcher still fires on
  // local refs, but we no-op so the canvas state is the only source
  // of truth until the customer registers.
  if (isAnonymousEditor.value) return
  if (!order.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await patchDraftFields()
    } catch {
      toast.error('No pudimos guardar tus cambios. Probá de nuevo.')
    }
  }, 400)
}

watch([material, withRelief, reliefNote, shape], maybePersistOrderEdit)

/**
 * Manual save — the "Guardar borrador" button. Differs from the
 * debounced autosave in three ways:
 *   1. Cancels any pending debounce and PATCHes immediately.
 *   2. Also uploads the current cut mask if one exists (autosave only
 *      covers draft fields; the cut polygon is saved on Continuar).
 *   3. Shows a confirmation toast so the customer has explicit
 *      feedback that their work is safe.
 */
async function onSaveDraft() {
  // Anonymous mode can't save — auth-wall instead. Same UX as Continuar.
  if (isAnonymousEditor.value) {
    authWallOpen.value = true
    return
  }
  if (!order.value || !canvasRef.value || isSaving.value) return
  // Cancel any in-flight debounce so we don't race against our own
  // explicit save.
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  isSaving.value = true
  try {
    // 1. Flush draft fields (material / shape / relief).
    await patchDraftFields()
    // 2. Upload the current cut mask if one exists. Same logic as
    //    onContinue: delete the previous die_cut_mask file, upload the
    //    new one. unique_together(order, kind) requires this dance.
    if (canvasRef.value.hasMask()) {
      const blob = await canvasRef.value.getMaskAsBlob()
      if (blob) {
        const existing = order.value.files.find((f) => f.kind === 'die_cut_mask')
        if (existing) {
          await filesService.delete(orderUuid.value, existing.uuid)
        }
        await filesService.upload(orderUuid.value, 'die_cut_mask', blob)
      }
      // 3. Snapshot the editor's composite view too (same as onContinue).
      //    Non-blocking on failure — the draft still saves without the preview.
      try {
        const composite = await canvasRef.value.getCompositeAsBlob()
        if (composite) {
          const prevPreview = order.value.files.find(
            (f) => f.kind === 'preview_composite',
          )
          if (prevPreview) {
            await filesService.delete(orderUuid.value, prevPreview.uuid)
          }
          await filesService.upload(orderUuid.value, 'preview_composite', composite)
        }
      } catch {
        // Best-effort; ignore.
      }
      // Refresh order.files so subsequent saves find the new files.
      order.value = await ordersService.retrieve(orderUuid.value)
    }
    toast.success('Borrador guardado.')
  } catch {
    toast.error('No pudimos guardar el borrador. Probá de nuevo.')
  } finally {
    isSaving.value = false
  }
}

// When the customer switches shape inside the editor, repaint the mask
// immediately. For geometric shapes that means a new primitive polygon;
// for contorneado, leave whatever auto-cut mask exists alone.
watch(shape, (newShape) => {
  // Clamp the margin slider to the new shape's lower bound. Geometric
  // shapes allow negative margins; contorneado floors at 5 mm. Without
  // this, switching geometric→contorneado with a negative margin
  // selected would render below the print-shop floor and the OpenCV
  // re-run would fail validation.
  const floor = newShape === 'contorneado' ? 5 : -30
  const current = cropOptions.value.marginMm ?? 15
  if (current < floor) {
    cropOptions.value = { ...cropOptions.value, marginMm: floor }
  }
  // Re-center the geometric shape whenever the customer picks a new
  // one. They explicitly chose a primitive; the expected mental model
  // is "start from centered, then drag if needed", not "carry over the
  // last drag offset from a different shape".
  shapeOffset.value = { x: 0, y: 0 }
  applyGeometricMaskIfNeeded()
})

// === Save / Continue ===

async function onContinue() {
  // Anonymous mode — auth wall. The customer played in the editor; now
  // we ask them to register to continue. They lose editor state (design
  // tradeoff: simpler than IDB-stashing the blob + mask).
  if (isAnonymousEditor.value) {
    authWallOpen.value = true
    return
  }
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

    // Also snapshot the editor's composite view (artwork + halo + FX as
    // the customer sees it) so the admin detail view can show their
    // exact final design. Failure here is non-fatal — the order
    // continues, the admin just falls back to original + die_cut_mask
    // separately.
    try {
      const composite = await canvasRef.value.getCompositeAsBlob()
      if (composite) {
        const prevPreview = order.value.files.find(
          (f) => f.kind === 'preview_composite',
        )
        if (prevPreview) {
          await filesService.delete(orderUuid.value, prevPreview.uuid)
        }
        await filesService.upload(orderUuid.value, 'preview_composite', composite)
      }
    } catch {
      // Best-effort. Don't block Continuar; the order is still valid
      // without the preview.
    }

    router.push({ name: 'order-config', params: { uuid: orderUuid.value } })
  } catch {
    toast.error('No pudimos guardar la línea de corte. Intentá de nuevo.')
  } finally {
    isSaving.value = false
  }
}

function onBack() {
  // Anonymous mode has no dashboard to fall back to — just send the
  // customer home where they can browse the catalog or try again.
  if (isAnonymousEditor.value) {
    router.push('/')
    return
  }
  // Editor is now step 1 — "back" goes to the dashboard rather than
  // a separate upload page. Customer's in-progress draft persists
  // (autosave) so they can come back via Borradores filter.
  router.push('/dashboard')
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

    // If the order has no `original` image yet, leave the editor in
    // empty-state mode — the template renders an UploadDropzone in
    // place of the CanvasStage. The customer drops their image,
    // onOriginalFileSelected uploads it and runs the canvas-load tail
    // below. Inspector stays usable so they can pre-pick a material.
    const original = order.value.files.find((f) => f.kind === 'original')
    if (!original) return

    // Push the initial palette into the canvas so a returning customer with
    // a material already chosen sees the right halo color on Auto cut.
    canvasRef.value?.setMaskPalette(getMaskPalette(material.value))
    canvasRef.value?.setTransparentMaterial(material.value === 'vinilo_transparente')
    canvasRef.value?.setMaterialActive(
      material.value !== '' && material.value !== 'vinilo_transparente',
    )
    canvasRef.value?.setHolographicMaterial(
      material.value === 'holografico' ||
        material.value === 'holografico_transparente',
    )
    canvasRef.value?.setEffectMode(effectModeFor(material.value))
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

/**
 * Handler for the empty-state UploadDropzone (rendered when the order
 * has no `original` file yet). Uploads the file, refetches the order
 * to pick up the new file, then runs the canvas-load tail of
 * bootstrapEditor so the editor transitions from empty state to
 * normal editing.
 *
 * Errors don't navigate away — the dropzone stays visible so the
 * customer can retry without losing their place.
 */
async function onOriginalFileSelected(file: File) {
  // Anonymous mode: skip the backend. Keep the File in memory; produce
  // an Object URL so the canvas can render it. No order to refetch, no
  // files list to update. The canvas-load tail below still applies —
  // material setup, geometric mask, etc. — because those are pure
  // canvas operations.
  if (isAnonymousEditor.value) {
    anonymousFile.value = file
    isSaving.value = true
    try {
      await nextTick()
      canvasRef.value?.setMaskPalette(getMaskPalette(material.value))
      canvasRef.value?.setTransparentMaterial(material.value === 'vinilo_transparente')
      canvasRef.value?.setMaterialActive(
        material.value !== '' && material.value !== 'vinilo_transparente',
      )
      canvasRef.value?.setHolographicMaterial(
        material.value === 'holografico' ||
          material.value === 'holografico_transparente',
      )
      canvasRef.value?.setEffectMode(effectModeFor(material.value))
      canvasRef.value?.setRemoveBackground(removeBackground.value)
      const localUrl = URL.createObjectURL(file)
      await loadImageIntoEditor(localUrl)
      applyGeometricMaskIfNeeded()
    } catch (e) {
      console.error('[editor anon] file decode failed:', e)
      toast.error('No pudimos cargar tu imagen. Probá con otro archivo.')
    } finally {
      isSaving.value = false
    }
    return
  }
  if (!order.value) return
  isSaving.value = true
  try {
    await filesService.upload(orderUuid.value, 'original', file)
    // Refetch so order.files reflects the upload. hasOriginalFile flips
    // true → template swaps the empty-state for the CanvasStage. Wait
    // a tick so the canvas component mounts before we push state into it.
    order.value = await ordersService.retrieve(orderUuid.value)
    const original = order.value.files.find((f) => f.kind === 'original')
    if (!original) {
      throw new Error('Upload succeeded but original file missing from order.')
    }
    await nextTick()
    // Mirror the canvas-load tail of bootstrapEditor (kept inline here
    // rather than extracted because the bootstrap path runs material
    // hydration BEFORE the file fetch — see lastSavedSnapshot above).
    canvasRef.value?.setMaskPalette(getMaskPalette(material.value))
    canvasRef.value?.setTransparentMaterial(material.value === 'vinilo_transparente')
    canvasRef.value?.setMaterialActive(
      material.value !== '' && material.value !== 'vinilo_transparente',
    )
    canvasRef.value?.setHolographicMaterial(
      material.value === 'holografico' ||
        material.value === 'holografico_transparente',
    )
    canvasRef.value?.setEffectMode(effectModeFor(material.value))
    canvasRef.value?.setRemoveBackground(removeBackground.value)
    const localUrl = await fetchAsObjectUrl(original)
    await loadImageIntoEditor(localUrl)
    applyGeometricMaskIfNeeded()
  } catch (e) {
    console.error('[editor] original-file upload failed:', e)
    const detail =
      (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
      'No pudimos subir tu archivo. Probá de nuevo.'
    toast.error(detail)
  } finally {
    isSaving.value = false
  }
}

onMounted(() => {
  if (isAnonymousEditor.value) {
    // Skip every backend operation. The editor renders its
    // empty-state dropzone; once the customer drops a file we keep
    // it in memory (anonymousFile). Inspector defaults are fine.
    isLoading.value = false
    return
  }
  bootstrapEditor()
})
</script>

<template>
  <section class="px-8 py-6 md:px-12 lg:px-16">
    <AppStepper
      :steps="steps"
      :current="1"
      class="mb-6"
    />

    <!-- Top bar — stacks on mobile so the title + action buttons don't
         crowd at narrow widths. Title row first, action buttons row
         below. Title font scaled down on small screens. -->
    <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div class="flex items-center gap-2 sm:gap-3">
        <AppButton
          variant="ghost"
          size="sm"
          @click="onBack"
        >
          ← Volver
        </AppButton>
        <h1 class="text-xl font-bold text-text sm:text-h3">
          Editor de sticker
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <AppButton
          variant="secondary"
          size="sm"
          :disabled="isSaving"
          :loading="isSaving"
          data-testid="editor-save-draft"
          class="flex-1 sm:flex-none"
          @click="onSaveDraft"
        >
          Guardar borrador
        </AppButton>
        <AppButton
          size="sm"
          :loading="isSaving"
          data-testid="editor-continue"
          class="flex-1 sm:flex-none"
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

    <!-- Editor body — responsive layout:
         Desktop (lg+): 3-column grid [toolbar 120 / canvas 1fr / inspector 340].
           Toolbar vertical sidebar, inspector inline at right.
         Mobile (< lg): single column stack.
           Toolbar horizontal strip at top, canvas, status banner, then
           a "Ajustes" sticky button that opens the inspector as a
           bottom sheet. -->
    <div
      v-if="!isLoading"
      class="grid gap-4 lg:gap-8 lg:grid-cols-[120px_1fr_340px]"
    >
      <!-- Toolbar — vertical sidebar on desktop, horizontal strip on
           mobile. Same component instance is recreated when isDesktop
           flips (cheap; the toolbar is stateless beyond its props). -->
      <EditorToolbar
        :is-processing="isProcessing"
        :is-open-cv-ready="openCvReady"
        :shape="shape"
        :is-smart-cutting="isSmartCutting"
        :has-original="hasOriginalFile"
        :is-smart-cut-active="cutMode === 'smart'"
        :zoom-level="zoomLevel"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :orientation="isDesktop ? 'vertical' : 'horizontal'"
        @auto-cut="onAutoCut"
        @smart-cut="onSmartCut"
        @reset="onReset"
        @zoom="onZoom"
        @undo="onUndo"
        @redo="onRedo"
      />

      <!-- Center: canvas + status banner + mobile Ajustes trigger.
           When the order has no `original` file yet, render the
           UploadDropzone in place of the canvas. The customer drops
           their image, onOriginalFileSelected uploads it and the
           bootstrap tail loads the canvas — at which point the dropzone
           disappears and the canvas takes over. Inspector + toolbar
           stay mounted across the transition so any material/shape
           pre-selection is preserved. -->
      <div class="flex flex-col gap-3">
        <!-- Empty state: no original yet → upload dropzone full-square. -->
        <div
          v-if="!hasOriginalFile"
          class="mx-auto aspect-square w-full"
          :style="{
            maxWidth: isDesktop
              ? 'min(100%, calc(100svh - 320px))'
              : 'min(100%, calc(100svh - 400px))',
          }"
          data-testid="editor-empty-state"
        >
          <UploadDropzone @file-selected="onOriginalFileSelected" />
        </div>

        <!-- Canvas state: original loaded → the 4-layer stack renders. -->
        <!-- Zoom wrapper: CSS scale around the canvas-stack. Overflow
             hidden keeps the scaled canvas clipped to its grid cell so
             it doesn't spill into the side rails. transform-origin
             center means the canvas grows from its visual center —
             always centered regardless of zoom level.

             Size cap: CanvasStage is `aspect-square w-full`, so on a
             very wide center column the square would balloon past the
             viewport height and force the customer to scroll. We cap
             the wrapper to (svh - 320px) — 320 covers the header (88) +
             stepper (~80) + title row (~50) + status banner below the
             canvas (~60) + paddings/gaps (~40). The min(...) takes the
             smaller of "fit the column width" and "fit the viewport
             height" — square canvas stays bounded by either. mx-auto
             centers the resulting box if column width > computed
             height. -->
        <div
          v-else
          class="mx-auto aspect-square w-full overflow-hidden"
          :style="{
            maxWidth: isDesktop
              ? 'min(100%, calc(100svh - 320px))'
              : 'min(100%, calc(100svh - 400px))',
          }"
        >
          <CanvasStage
            ref="canvasRef"
            :ui-cursor="shape === 'contorneado' ? 'default' : 'grab'"
            :style="{
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'center center',
              transition: 'transform 180ms ease-out',
            }"
            @canvas-pointerdown="onCanvasPointerDown"
          />
        </div>

        <!-- Auto-crop / smart-cut status banner -->
        <div
          v-if="isProcessing || isSmartCutting"
          class="rounded-md border border-warning/40 bg-warning/10 px-4 py-5 text-center text-base text-warning"
          data-testid="editor-processing"
        >
          {{ isSmartCutting
            ? 'Aplicando recorte inteligente…'
            : (progressMessage || 'Detectando el contorno…') }}
        </div>
        <div
          v-else-if="noContourMessage"
          class="rounded-md border border-warning/40 bg-warning/10 px-4 py-5 text-center text-base text-warning"
          data-testid="editor-no-contour"
        >
          {{ noContourMessage }}
        </div>
        <div
          v-else-if="autoCropError"
          class="rounded-md border border-error/40 bg-error/10 px-4 py-5 text-center text-base text-error"
        >
          {{ autoCropError }}
        </div>
        <div
          v-else-if="shape !== 'contorneado'"
          class="rounded-md border border-border bg-surface-2 px-4 py-5 text-center text-base text-text-muted"
          data-testid="editor-shape-fixed"
        >
          Forma <strong>{{ shape }}</strong> aplicada. Ajustá el margen abajo.
        </div>
        <div
          v-else-if="!openCvReady"
          class="rounded-md border border-border bg-surface-2 px-4 py-5 text-center text-base text-text-muted"
          data-testid="editor-loading-engine"
        >
          Cargando motor de detección…
          <span class="block text-xs text-text-muted/80">
            La primera carga puede tardar unos segundos. Mientras tanto podés continuar.
          </span>
        </div>
        <div
          v-else
          class="rounded-md border border-border bg-surface-2 px-4 py-5 text-center text-base text-text-muted"
          data-testid="editor-ready"
        >
          Tocá <strong>Auto cut</strong> para detectar el contorno.
        </div>
      </div>

      <!-- Mobile-only: open the inspector as a bottom sheet. Sticky at
           the bottom of the center column so it sits below the status
           banner. Hidden on desktop where the inspector renders inline
           in its own grid column. -->
      <button
        v-if="!isDesktop"
        type="button"
        class="flex items-center justify-center gap-2 rounded-lg border border-primary bg-primary/10 px-4 py-4 text-base font-semibold text-primary transition active:bg-primary/20"
        data-testid="open-inspector-sheet"
        @click="inspectorSheetOpen = true"
      >
        <span aria-hidden="true">⚙️</span>
        Ajustes
      </button>

      <!-- Right: inspector (desktop only) -->
      <EditorInspector
        v-if="isDesktop"
        :mask-visible="maskVisible"
        :remove-background="removeBackground"
        :options="cropOptions"
        :material="material"
        :shape="shape"
        :with-relief="withRelief"
        :relief-note="reliefNote"
        :smoothing="smoothingSlider"
        :has-active-mask="hasActiveMask"
        @update:mask-visible="maskVisible = $event"
        @update:remove-background="onInspectorChange('removeBackground', $event)"
        @update:options="cropOptions = $event"
        @update:material="onInspectorChange('material', $event)"
        @update:shape="onInspectorChange('shape', $event)"
        @update:with-relief="onInspectorChange('withRelief', $event)"
        @update:relief-note="reliefNote = $event"
        @update:smoothing="smoothingSlider = $event"
      />
    </div>

    <!-- Mobile inspector bottom sheet — teleported to body so the
         backdrop/sheet sit above all other editor chrome. Opens via
         the Ajustes button above. Inspector content scrolls inside
         the sheet (sheet has max-h 80svh + overflow handling). -->
    <AppBottomSheet
      v-if="!isLoading && !isDesktop"
      :open="inspectorSheetOpen"
      title="Ajustes"
      @close="inspectorSheetOpen = false"
    >
      <EditorInspector
        :mask-visible="maskVisible"
        :remove-background="removeBackground"
        :options="cropOptions"
        :material="material"
        :shape="shape"
        :with-relief="withRelief"
        :relief-note="reliefNote"
        :smoothing="smoothingSlider"
        :has-active-mask="hasActiveMask"
        @update:mask-visible="maskVisible = $event"
        @update:remove-background="onInspectorChange('removeBackground', $event)"
        @update:options="cropOptions = $event"
        @update:material="onInspectorChange('material', $event)"
        @update:shape="onInspectorChange('shape', $event)"
        @update:with-relief="onInspectorChange('withRelief', $event)"
        @update:relief-note="reliefNote = $event"
        @update:smoothing="smoothingSlider = $event"
      />
    </AppBottomSheet>

    <div
      v-else
      class="rounded-lg border border-border bg-surface-2 p-12 text-center text-text-muted"
    >
      Cargando editor…
    </div>

    <!-- Anonymous mode: persistent reminder so the customer knows their
         work isn't being saved. Sticky to the viewport bottom so it
         stays visible while they scroll the editor. -->
    <div
      v-if="isAnonymousEditor"
      class="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4"
    >
      <div class="pointer-events-auto flex max-w-3xl items-center gap-3 rounded-lg border border-primary/40 bg-surface-1/95 px-4 py-3 text-sm text-text shadow-card backdrop-blur">
        <span aria-hidden="true">⚠️</span>
        <span class="flex-1">
          Estás probando sin cuenta. Creá una gratuita para guardar tu diseño
          y hacer el pedido.
        </span>
        <AppButton
          size="sm"
          data-testid="anon-banner-register"
          @click="authWallOpen = true"
        >
          Crear cuenta
        </AppButton>
      </div>
    </div>

    <!-- Auth wall — fires when the anonymous customer clicks Continuar,
         Guardar, or any "next step" CTA. They lose editor state on
         either action (design tradeoff: simpler than IDB stash). -->
    <AppModal
      :open="authWallOpen"
      title="Creá tu cuenta para continuar"
      @close="authWallOpen = false"
    >
      <p class="text-sm text-text-muted">
        Estás probando el editor sin cuenta. Para guardar tu diseño,
        elegir material y tamaño, y hacer el pedido, creá una cuenta
        gratuita. Solo te pedimos email y un nombre.
      </p>
      <p class="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
        Al continuar perderás los cambios actuales del editor —
        tendrás que volver a subir tu diseño después de registrarte.
        Estamos trabajando para que tu sesión se guarde automáticamente.
      </p>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <AppButton
          variant="ghost"
          @click="authWallOpen = false"
        >
          Seguir probando
        </AppButton>
        <AppButton
          variant="ghost"
          data-testid="anon-modal-login"
          @click="router.push('/login')"
        >
          Iniciar sesión
        </AppButton>
        <AppButton
          data-testid="anon-modal-register"
          @click="router.push('/register')"
        >
          Crear cuenta
        </AppButton>
      </div>
    </AppModal>
  </section>
</template>
