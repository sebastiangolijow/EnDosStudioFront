/**
 * Auto-crop Web Worker.
 *
 * The OpenCV.js WASM bundle is ~10 MB. Compiling it on the main thread blocks
 * the page hard enough that Chrome's hang detector fires "Page Unresponsive".
 * Moving the runtime + pipeline into a worker keeps the main thread free —
 * the page paints normally, the editor's UI stays interactive, and only the
 * worker thread is busy while WASM compiles.
 *
 * Wire format:
 *   In:  { kind: 'auto-crop', requestId, imageData, naturalWidth, naturalHeight, options }
 *   Out: { kind: 'ready', requestId } | { kind: 'progress', requestId, message }
 *      | { kind: 'result', requestId, result } | { kind: 'error', requestId, message }
 *
 * `imageData` is the source image rendered into a working-size offscreen
 * canvas (≤ 1024 px long edge) and read out as ImageData. ImageData crosses
 * the worker boundary by structured-clone — the underlying ArrayBuffer is
 * copied, not transferred, because we still need it on the main thread for
 * the canvas display. (Transferring would zero out the source array.)
 *
 * Memory rule (per opencv-js-integration skill): every cv.Mat / cv.MatVector
 * MUST be `.delete()`-ed in `finally`. The worker context is long-lived;
 * leaks accumulate across runs the same way they do on the main thread.
 */

/// <reference lib="webworker" />

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.x/opencv.js'

declare const cv: OpenCv

interface MatLike {
  delete(): void
  rows: number
  cols: number
  intAt(row: number, col: number): number
}
interface MatVectorLike {
  delete(): void
  size(): number
  get(idx: number): MatLike
}
interface OpenCv {
  Mat: {
    new (rows?: number, cols?: number, type?: number, scalar?: unknown): MatLike
    zeros(rows: number, cols: number, type: number): MatLike
  }
  MatVector: { new (): MatVectorLike }
  Size: { new (w: number, h: number): { width: number; height: number } }
  Scalar: { new (a: number, b?: number, c?: number, d?: number): unknown }
  matFromImageData(imageData: ImageData): MatLike
  cvtColor(src: MatLike, dst: MatLike, code: number): void
  GaussianBlur(
    src: MatLike,
    dst: MatLike,
    ksize: { width: number; height: number },
    sigmaX: number,
    sigmaY: number,
    borderType: number,
  ): void
  Canny(src: MatLike, dst: MatLike, threshold1: number, threshold2: number): void
  threshold(
    src: MatLike,
    dst: MatLike,
    thresh: number,
    maxval: number,
    type: number,
  ): number
  inRange(src: MatLike, lowerb: MatLike, upperb: MatLike, dst: MatLike): void
  morphologyEx(src: MatLike, dst: MatLike, op: number, kernel: MatLike): void
  findContours(
    image: MatLike,
    contours: MatVectorLike,
    hierarchy: MatLike,
    mode: number,
    method: number,
  ): void
  contourArea(contour: MatLike): number
  approxPolyDP(curve: MatLike, approx: MatLike, epsilon: number, closed: boolean): void
  drawContours(
    image: MatLike,
    contours: MatVectorLike,
    contourIdx: number,
    color: unknown,
    thickness: number,
  ): void
  dilate(
    src: MatLike,
    dst: MatLike,
    kernel: MatLike,
    anchor?: { x: number; y: number },
    iterations?: number,
  ): void
  bitwise_not(src: MatLike, dst: MatLike): void
  bitwise_or(src1: MatLike, src2: MatLike, dst: MatLike): void
  convexHull(points: MatLike, hull: MatLike, clockwise?: boolean, returnPoints?: boolean): void
  getStructuringElement(
    shape: number,
    ksize: { width: number; height: number },
  ): MatLike
  matFromArray(rows: number, cols: number, type: number, array: number[]): MatLike

  COLOR_RGBA2GRAY: number
  COLOR_RGBA2RGB: number
  BORDER_DEFAULT: number
  RETR_EXTERNAL: number
  CHAIN_APPROX_SIMPLE: number
  CHAIN_APPROX_NONE: number
  CV_8UC1: number
  CV_8UC3: number
  CV_32FC3: number
  FILLED: number
  MORPH_ELLIPSE: number
  MORPH_OPEN: number
  MORPH_CLOSE: number
  THRESH_BINARY: number
  THRESH_BINARY_INV: number
  THRESH_OTSU: number

  onRuntimeInitialized?: () => void
}

interface AutoCropOptions {
  cannyLow?: number
  cannyHigh?: number
  blurRadius?: number
  polyEpsilon?: number
  /** Outward bleed margin around the contour (mm). Default 15. */
  marginMm?: number
}

interface ImagePoint {
  kind: 'image'
  x: number
  y: number
}

type DieCutResult =
  | {
      kind: 'ok'
      /** Cut polygon in image-natural pixels (artwork + bleed). */
      points: ImagePoint[]
      areaPx: number
      /** Tight artwork silhouette (no bleed). Used by the canvas to clip
       *  the base image so the halo shows in the bleed area without the
       *  photo's background occluding it. Same coordinates as `points`. */
      artworkPoints?: ImagePoint[]
    }
  | { kind: 'no-contour-found' }

type IncomingMessage =
  | {
      kind: 'auto-crop'
      requestId: number
      imageData: ImageData
      // The working-size canvas the imageData came from. Polygon points are
      // in working-pixel space; the main thread scales them back to
      // image-natural coordinates using the natural dims it owns.
      workingWidth: number
      workingHeight: number
      naturalWidth: number
      naturalHeight: number
      // Image-natural pixels per mm at print resolution. The worker uses
      // this to convert `marginMm` to a pixel dilation amount. The main
      // thread computes pxPerMm from the order's chosen width or a
      // sensible default. If null, the dilate step is skipped.
      pxPerMm: number | null
      options: AutoCropOptions
    }

type OutgoingMessage =
  | { kind: 'ready'; requestId: number }
  | { kind: 'progress'; requestId: number; message: string }
  | { kind: 'result'; requestId: number; result: DieCutResult }
  | { kind: 'error'; requestId: number; message: string }

// Module-scoped readiness gate. The worker loads opencv.js exactly once;
// every incoming auto-crop request awaits this same promise.
let readyPromise: Promise<void> | null = null

function whenCvReady(): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = new Promise<void>((resolve, reject) => {
    try {
      // importScripts is only available in classic workers — this file is
      // bundled by Vite as { type: 'classic' } in useAutoCropWorker.ts.
       
      ;(self as unknown as { importScripts: (url: string) => void }).importScripts(OPENCV_CDN_URL)
    } catch (e) {
      reject(new Error(`importScripts failed: ${(e as Error).message}`))
      return
    }
    if (typeof cv === 'undefined') {
      reject(new Error('OpenCV.js loaded but cv global is undefined'))
      return
    }
    if ((cv as OpenCv).Mat) {
      resolve()
      return
    }
    ;(cv as OpenCv).onRuntimeInitialized = () => resolve()
  })
  return readyPromise
}

function post(msg: OutgoingMessage) {
  ;(self as unknown as Worker).postMessage(msg)
}

/**
 * Offset a closed polygon outward by `distance` (in the same units as the
 * polygon points). Each vertex is moved along the local outward normal
 * computed from its neighboring vertices' edge bisector.
 *
 * Why this exists (and not cv.dilate):
 *   - Mask dilation by N px is the Minkowski sum of the silhouette with
 *     a disk of radius N. For irregular silhouettes (fur, hair), all
 *     concavities narrower than 2N collapse — the result loses detail
 *     and looks like a rounded blob. NOT what we want.
 *   - Per-vertex offset preserves every concavity. The cut path follows
 *     the silhouette's shape exactly, just N pixels outward. The
 *     customer sees fur tufts, ear curves, and so on, all preserved
 *     at any margin.
 *
 * Caveats:
 *   - Sharp concavities can cause neighboring offset points to cross
 *     ("self-intersection"). We don't cleanly resolve these; the
 *     render-time smoothing pass papers over the visual artifact.
 *     For a print-perfect cutter file, a proper polygon-offset
 *     library (Clipper2) would be needed; M3a tolerates the rough
 *     edges in exchange for keeping the worker dependency-free.
 *
 * Winding assumption: OpenCV's findContours with RETR_EXTERNAL returns
 * outer contours in CLOCKWISE order under image coordinates (Y-down).
 * Outward normal of an edge from p[i-1] to p[i+1] (image-Y-down,
 * clockwise polygon) is the LEFT-perpendicular of the edge vector,
 * i.e. rotate 90° counterclockwise in screen-space:
 *     edge = (dx, dy)  →  normal = (-dy, dx)  [length |edge|]
 * We use the bisector (neighbor-to-neighbor edge) instead of single-edge
 * normals so the offset varies smoothly between vertices.
 */
function offsetPolygonOutward(
  points: ImagePoint[],
  distance: number,
): ImagePoint[] {
  const n = points.length
  if (n < 3 || distance <= 0) {
    return points.map((p) => ({ kind: 'image', x: p.x, y: p.y }))
  }
  const out: ImagePoint[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      out[i] = { kind: 'image', x: points[i].x, y: points[i].y }
      continue
    }
    // Outward normal under clockwise winding + Y-down: rotate 90° CCW.
    const nx = -dy / len
    const ny = dx / len
    out[i] = {
      kind: 'image',
      x: points[i].x + nx * distance,
      y: points[i].y + ny * distance,
    }
  }
  return out
}

// === Pre-pass: scan ImageData on JS side ===
//
// Two cheap inspections on the raw RGBA bytes drive strategy selection:
//   1. Does the image have meaningful transparency? (any pixel with α < 250)
//   2. What's the dominant background color? (sample edges + corners)
//
// We do this on the JS side because it's faster than copying the data into
// a Mat and OpenCV-walking it; it's just typed-array iteration.

interface ImageInspection {
  hasAlpha: boolean
  /** Sampled background color in RGB (0–255). Median of edge pixels. */
  bgR: number
  bgG: number
  bgB: number
  /** Standard deviation of edge pixels — high stddev = busy/textured edges,
   *  in which case background-color trim is unreliable and we should
   *  fall through to Canny. */
  bgStdDev: number
}

function inspectImage(data: Uint8ClampedArray, w: number, h: number): ImageInspection {
  // Alpha pass: any pixel meaningfully transparent?
  let hasAlpha = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      hasAlpha = true
      break
    }
  }

  // Edge sampling: walk the perimeter (top + bottom rows, left + right cols).
  // Use median, not mean — robust against the artwork peeking into the
  // border. Stride large samples to keep this fast on big images.
  const samples: { r: number; g: number; b: number }[] = []
  const stride = Math.max(1, Math.round(Math.max(w, h) / 200))
  for (let x = 0; x < w; x += stride) {
    const top = (0 * w + x) * 4
    const bot = ((h - 1) * w + x) * 4
    samples.push({ r: data[top], g: data[top + 1], b: data[top + 2] })
    samples.push({ r: data[bot], g: data[bot + 1], b: data[bot + 2] })
  }
  for (let y = 0; y < h; y += stride) {
    const left = (y * w + 0) * 4
    const right = (y * w + (w - 1)) * 4
    samples.push({ r: data[left], g: data[left + 1], b: data[left + 2] })
    samples.push({ r: data[right], g: data[right + 1], b: data[right + 2] })
  }
  const median = (key: 'r' | 'g' | 'b') => {
    const sorted = samples.map((s) => s[key]).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const bgR = median('r')
  const bgG = median('g')
  const bgB = median('b')
  // Distance of each sample from the median, then mean — good-enough stddev.
  let totalDist = 0
  for (const s of samples) {
    const dr = s.r - bgR
    const dg = s.g - bgG
    const db = s.b - bgB
    totalDist += Math.sqrt(dr * dr + dg * dg + db * db)
  }
  const bgStdDev = totalDist / samples.length

  return { hasAlpha, bgR, bgG, bgB, bgStdDev }
}

async function handleAutoCrop(req: Extract<IncomingMessage, { kind: 'auto-crop' }>) {
  const {
    requestId,
    imageData,
    workingWidth,
    workingHeight,
    naturalWidth,
    naturalHeight,
    pxPerMm,
    options,
  } = req

  try {
    post({ kind: 'progress', requestId, message: 'Cargando OpenCV…' })
    await whenCvReady()
    post({ kind: 'progress', requestId, message: 'Detectando contorno…' })

    const cannyLow = options.cannyLow ?? 50
    const cannyHigh = options.cannyHigh ?? 150
    const blurRadius = options.blurRadius ?? 5
    // Lower epsilon = more polygon vertices = smoother curve render. The
    // canvas-layer renderer (useCanvasEditor.drawMaskLayer) draws the
    // path as quadratic curves through midpoints, so vertex density is
    // what controls visual smoothness. 1.5 px keeps ~100-300 points
    // around a typical silhouette — plenty for buttery curves without
    // bloating the postMessage payload.
    const polyEpsilon = options.polyEpsilon ?? 1.5
    const marginMm = options.marginMm ?? 15
    const kernel = blurRadius % 2 === 0 ? blurRadius + 1 : blurRadius

    // Working-space scale: image-natural-px ↔ working-px. The bleed margin
    // is applied as a per-vertex offset along the contour normal (post-
    // contour-extract), so we don't need to size any kernels in working
    // pixels — just compute the offset distance in image-natural pixels.
    const scaleX = naturalWidth / workingWidth
    const scaleY = naturalHeight / workingHeight
    const marginNaturalPx =
      pxPerMm != null && marginMm > 0 ? marginMm * pxPerMm : 0

    // Pre-pass on the raw ImageData (no OpenCV needed).
    const inspection = inspectImage(imageData.data, workingWidth, workingHeight)

    const src = cv.matFromImageData(imageData)
    const gray = new cv.Mat()
    const blurred = new cv.Mat()
    const edges = new cv.Mat()
    const rawContours = new cv.MatVector()
    const hierarchy1 = new cv.Mat()
    // Filled silhouette mask. The contour extracted from this is the
    // tight artwork outline; the cut path is generated by offsetting
    // the contour points outward (see offsetPolygonOutward below).
    const filled = cv.Mat.zeros(workingHeight, workingWidth, cv.CV_8UC1)
    // Buffers for color-distance / threshold paths.
    const rgb = new cv.Mat()
    const bgLow = new cv.Mat()
    const bgHigh = new cv.Mat()
    const colorMask = new cv.Mat()
    // Two morphology kernels: a small one to clean speckle on alpha masks,
    // and a wide one to bridge edge breaks in bg-trim (where dark artwork
    // merges with shadow at the silhouette edge and inRange chops it into
    // disconnected chunks). 15×15 is enough to bridge ~7 px gaps without
    // visibly distorting the silhouette.
    const morphKernelSmall = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5))
    const morphKernelWide = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15))
    // Tight contour — the artwork silhouette. The main thread uses it as
    // a clip mask so the halo shows in the bleed margin without the
    // photo's white background occluding it. Source for both the tight
    // (artworkPoints) and the offset (cut path) polygons.
    const tightContours = new cv.MatVector()
    const hierarchyTight = new cv.Mat()

    try {
      const totalPixels = workingWidth * workingHeight
      // Drop tiny noise contours (< 1% of canvas) and ignore the canvas
      // boundary itself (≥ 99%). The remainder is "real artwork."
      const MIN_AREA = totalPixels * 0.005
      const MAX_AREA = totalPixels * 0.99

      // Helper: given a binary 8UC1 mask, paint the union of its real
      // contours into `filled`. Returns true if any contour was kept.
      // Per-strategy minArea so robust strategies can keep thinner pieces.
      function paintContoursFromMask(mask: MatLike, minArea: number): boolean {
        const localContours = new cv.MatVector()
        const localHierarchy = new cv.Mat()
        try {
          cv.findContours(
            mask,
            localContours,
            localHierarchy,
            cv.RETR_EXTERNAL,
            cv.CHAIN_APPROX_SIMPLE,
          )
          let kept = 0
          for (let i = 0; i < localContours.size(); i++) {
            const a = cv.contourArea(localContours.get(i))
            if (a < minArea || a > MAX_AREA) continue
            cv.drawContours(
              filled,
              localContours,
              i,
              new cv.Scalar(255, 255, 255, 255),
              cv.FILLED,
            )
            kept++
          }
          return kept > 0
        } finally {
          localContours.delete()
          localHierarchy.delete()
        }
      }

      // === Strategy A: alpha channel ===
      // Truth is in α: anything visible is artwork. Robust on transparent
      // PNGs (DNA helix, isolated logos, dotted text). No tuning needed.
      let strategyUsed: 'alpha' | 'bg-trim' | 'canny' | null = null
      if (inspection.hasAlpha) {
        // Build a single-channel alpha image. Fastest path: write the alpha
        // bytes into a fresh ImageData-backed Mat — but OpenCV.js doesn't
        // expose channel-split as cleanly as desktop OpenCV, so iterate.
        const alphaMask = new cv.Mat(workingHeight, workingWidth, cv.CV_8UC1)
        try {
          // alphaMask.data is a typed-array view we can fill.
          const dst = (alphaMask as unknown as { data: Uint8Array }).data
          const srcArr = imageData.data
          for (let i = 0; i < totalPixels; i++) {
            dst[i] = srcArr[i * 4 + 3] >= 128 ? 255 : 0
          }
          // A single MORPH_OPEN cleans up speckle without nuking thin features.
          cv.morphologyEx(alphaMask, alphaMask, cv.MORPH_OPEN, morphKernelSmall)
          if (paintContoursFromMask(alphaMask, MIN_AREA)) strategyUsed = 'alpha'
        } finally {
          alphaMask.delete()
        }
      }

      // === Strategy B: background-color trim ===
      // Image is opaque. If the perimeter is uniform-ish, the median edge
      // color is the background. Build a binary mask of "near-background"
      // pixels and invert. Skip if perimeter stddev is too high (busy
      // backgrounds defeat this assumption — Canny is the next fallback).
      const BG_STDDEV_THRESHOLD = 35
      if (
        strategyUsed === null &&
        !inspection.hasAlpha &&
        inspection.bgStdDev < BG_STDDEV_THRESHOLD
      ) {
        // Drop alpha channel — inRange wants 3-channel input.
        cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
        // Wider tolerance than the previous 25 — dark artwork against a
        // light bg can merge with edge shadow; the extra slack keeps the
        // silhouette continuous instead of breaking into chunks at the
        // bottom of e.g. a navy sweater on grey.
        const tol = 35
        const lo = [
          Math.max(0, inspection.bgR - tol),
          Math.max(0, inspection.bgG - tol),
          Math.max(0, inspection.bgB - tol),
        ]
        const hi = [
          Math.min(255, inspection.bgR + tol),
          Math.min(255, inspection.bgG + tol),
          Math.min(255, inspection.bgB + tol),
        ]
        // inRange's bounds must be Mats sized to the input; matFromArray
        // gives us 1×1×3 scalars that broadcast.
        const bgLowSrc = cv.matFromArray(1, 1, cv.CV_8UC3, lo)
        const bgHighSrc = cv.matFromArray(1, 1, cv.CV_8UC3, hi)
        try {
          cv.inRange(rgb, bgLowSrc, bgHighSrc, colorMask)
          // colorMask = 255 where pixel ≈ background. Invert to get artwork.
          cv.bitwise_not(colorMask, colorMask)
          // Aggressive close to bridge any breaks where artwork chunks were
          // disconnected by edge shadow / cuffs / dark stitching. NO open —
          // an open here erodes legitimate thin features (cuffs, hems,
          // narrow handles) and was the cause of the EME sweater's bottom
          // edge missing from the cut line. Min-area filtering on the
          // contour pass below handles speckle instead.
          cv.morphologyEx(colorMask, colorMask, cv.MORPH_CLOSE, morphKernelWide)
          // bg-trim is robust enough to skip the noise floor; a 0.1%-of-
          // canvas threshold lets thin pieces (e.g. a narrow sweater hem)
          // survive while still rejecting actual specks.
          if (paintContoursFromMask(colorMask, totalPixels * 0.001))
            strategyUsed = 'bg-trim'
        } finally {
          bgLowSrc.delete()
          bgHighSrc.delete()
        }
      }

      // === Strategy C: Canny edge detection (fallback) ===
      // Last resort. Works when there's a clear luminance edge between
      // sticker and background but neither alpha nor bg-color help.
      if (strategyUsed === null) {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
        cv.GaussianBlur(gray, blurred, new cv.Size(kernel, kernel), 0, 0, cv.BORDER_DEFAULT)
        cv.Canny(blurred, edges, cannyLow, cannyHigh)
        cv.findContours(edges, rawContours, hierarchy1, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

        // Canny gives many small edge pieces; pick max-area like before
        // (the alpha/bg-trim paths handle multi-piece artwork via union).
        let bestIdx = -1
        let bestArea = -1
        for (let i = 0; i < rawContours.size(); i++) {
          const a = cv.contourArea(rawContours.get(i))
          if (a < MIN_AREA || a > MAX_AREA) continue
          if (a > bestArea) {
            bestArea = a
            bestIdx = i
          }
        }
        if (bestIdx >= 0) {
          cv.drawContours(
            filled,
            rawContours,
            bestIdx,
            new cv.Scalar(255, 255, 255, 255),
            cv.FILLED,
          )
          strategyUsed = 'canny'
        }
      }

      if (strategyUsed === null) {
        post({ kind: 'result', requestId, result: { kind: 'no-contour-found' } })
        return
      }

      // Telemetry — useful in browser devtools when debugging a problem image.
      console.info(`[autocrop] strategy=${strategyUsed} hasAlpha=${inspection.hasAlpha} bgStdDev=${inspection.bgStdDev.toFixed(1)}`)

      // Extract the tight artwork contour at FULL density (CHAIN_APPROX_NONE
      // returns every boundary pixel). This gives 200-2000+ points around
      // a typical silhouette — the main thread uses these for both the
      // tight clip mask AND as the source for the offset bleed polygon.
      // approxPolyDP with a small epsilon downsamples just enough to keep
      // the postMessage payload reasonable (~150-400 points) without
      // collapsing concavities.
      cv.findContours(
        filled,
        tightContours,
        hierarchyTight,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_NONE,
      )

      if (tightContours.size() === 0) {
        post({ kind: 'result', requestId, result: { kind: 'no-contour-found' } })
        return
      }

      // Pick the largest tight contour. Multi-piece artwork: this is the
      // "main" piece. (We accept that a tiny disconnected piece won't be
      // included in the cut path; M3a doesn't try to handle multi-piece.)
      let tIdx = 0
      let tArea = -1
      for (let i = 0; i < tightContours.size(); i++) {
        const a = cv.contourArea(tightContours.get(i))
        if (a > tArea) {
          tArea = a
          tIdx = i
        }
      }
      const rawTight = new cv.Mat()
      try {
        cv.approxPolyDP(tightContours.get(tIdx), rawTight, polyEpsilon, true)
        const tightPoints: ImagePoint[] = []
        for (let i = 0; i < rawTight.rows; i++) {
          tightPoints.push({
            kind: 'image',
            x: rawTight.intAt(i, 0) * scaleX,
            y: rawTight.intAt(i, 1) * scaleY,
          })
        }

        // Build the cut polygon by offsetting each vertex along the
        // outward normal by `marginNaturalPx`. Pure geometry — no mask
        // dilation, so concavities (between fur tufts, ear curves, etc.)
        // are PRESERVED. This is what the customer wants: the cut line
        // follows the silhouette's general shape, just pushed outward.
        const cutPoints: ImagePoint[] =
          marginNaturalPx > 0
            ? offsetPolygonOutward(tightPoints, marginNaturalPx)
            : tightPoints.map((p) => ({ kind: 'image', x: p.x, y: p.y }))

        post({
          kind: 'result',
          requestId,
          result: {
            kind: 'ok',
            points: cutPoints,
            areaPx: tArea * scaleX * scaleY,
            artworkPoints: tightPoints.length >= 3 ? tightPoints : undefined,
          },
        })
      } finally {
        rawTight.delete()
      }
    } finally {
      src.delete()
      gray.delete()
      blurred.delete()
      edges.delete()
      rawContours.delete()
      hierarchy1.delete()
      filled.delete()
      rgb.delete()
      bgLow.delete()
      bgHigh.delete()
      colorMask.delete()
      morphKernelSmall.delete()
      morphKernelWide.delete()
      tightContours.delete()
      hierarchyTight.delete()
    }
  } catch (e) {
    post({
      kind: 'error',
      requestId,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data
  if (msg.kind === 'auto-crop') {
    void handleAutoCrop(msg)
  }
}

// Kick off the OpenCV load eagerly so by the time the customer hits
// Auto cut the runtime is already warm.
void whenCvReady().then(() => {
  post({ kind: 'ready', requestId: -1 })
})
