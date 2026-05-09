/**
 * Polygon geometry helpers used by the editor.
 *
 * The Web Worker (`autoCrop.worker.ts`) has its own copy of
 * `offsetPolygonOutward` for use INSIDE the worker — workers don't share
 * module scope with the main thread. This file is the main-thread mirror,
 * used by:
 *   - the smart-cut flow (extends the AI-detected tight polygon by the
 *     bleed margin without round-tripping through the worker / OpenCV).
 *   - the canvas renderer (perimeter-Gaussian smoothing before paint).
 *   - any future frontend-only feature that wants to re-offset / smooth
 *     a polygon after detection.
 *
 * Keep `offsetPolygonOutward` in sync with `src/workers/autoCrop.worker.ts`'s
 * copy — they implement identical math.
 */
import type { ImagePoint } from '@/composables/useAutoCropWorker'

/**
 * Smooth a closed polygon's vertex coordinates by perimeter-blurring.
 *
 * For each vertex p[i], replace it with a weighted average of itself and
 * its 2k neighbors (binomial weights centered on i). Equivalent to
 * convolving the polygon coordinates with a 1D Gaussian along the
 * perimeter. Each pass widens the effective kernel; passes are cheap
 * (O(n·k)) and the visual effect is uniform — small bumps and wide
 * concavities both smooth at proportional rates.
 *
 * Use cases:
 *   1. **Render smoothing** (canvas-time, "Suavidad" slider). Higher
 *      values = wavier, less detail.
 *   2. **Pre-offset stabilization** (smart-cut, before
 *      `offsetPolygonOutward`). Sharp concavities in the input cause
 *      neighboring offset points to cross (visible as polygon
 *      self-intersections / fragmentation at high margin values). A few
 *      pre-passes collapse those concavities into gentle curves so the
 *      offset stays a clean simple polygon at any margin.
 *
 * Implementation: rather than a true Gaussian, do `iterations` passes of
 * a 3-tap [1, 2, 1] / 4 kernel. Multiple passes converge to a Gaussian.
 *
 * Returns plain {x, y} points (no `kind` discriminator); callers that
 * need ImagePoint format wrap as needed.
 */
export function smoothPolygonPerimeter<T extends { x: number; y: number }>(
  points: T[],
  iterations: number,
): { x: number; y: number }[] {
  if (iterations <= 0 || points.length < 3) {
    return points.map((p) => ({ x: p.x, y: p.y }))
  }
  let pts: { x: number; y: number }[] = points.map((p) => ({ x: p.x, y: p.y }))
  const n = pts.length
  for (let iter = 0; iter < iterations; iter++) {
    const out: { x: number; y: number }[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n]
      const cur = pts[i]
      const next = pts[(i + 1) % n]
      out[i] = {
        x: (prev.x + 2 * cur.x + next.x) / 4,
        y: (prev.y + 2 * cur.y + next.y) / 4,
      }
    }
    pts = out
  }
  return pts
}

/**
 * Offset a closed polygon outward by `distance` (image-natural pixels).
 * Each vertex moves along the local outward normal computed from its
 * neighboring vertices' edge bisector.
 *
 * Same algorithm + caveats as the worker copy:
 *   - Preserves every concavity (no Minkowski-sum-with-disk collapse the
 *     way `cv.dilate` would).
 *   - Sharp concavities can produce neighboring offset points that cross
 *     ("self-intersection"). The canvas-layer `smoothPolygonPerimeter`
 *     pass papers over the visual artifact at the default smoothing
 *     setting; for cleaner output a proper polygon-offset library
 *     (Clipper2) would be needed — deferred to a future iteration.
 *   - Assumes clockwise winding (image-Y-down coordinates), which is
 *     what OpenCV's findContours and rembg's mask trace produce.
 */
export function offsetPolygonOutward(
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
    // Outward normal under clockwise winding + Y-down: rotate edge 90° CCW.
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
