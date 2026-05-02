/**
 * Material → mask colors used in the editor's cut-line halo.
 *
 * `fill` is either a flat CSS color OR a function that builds a
 * `CanvasGradient` for a given bounding box. Functions let us render
 * iridescent materials (holographic, eggshell holographic) with the same
 * visual the picker swatches use, instead of a flat approximation.
 *
 * `stroke` is the cut-line color — kept as a flat string because the line
 * is thin and the gradient wouldn't read.
 *
 * When no material is selected the default brand orange is used.
 */
import type { Material } from '@/types/order'

/** Bounding box of the polygon, in CSS pixels — passed to gradient factories. */
export interface MaskBBox {
  x: number
  y: number
  width: number
  height: number
}

/** Resolved fill spec — what gets passed to the canvas at draw time. */
export interface ResolvedFill {
  /** The actual fillStyle value. CanvasPattern, CanvasGradient, or a CSS string. */
  style: string | CanvasGradient | CanvasPattern
  /** globalAlpha to apply just for this fill operation. 1 = no alpha override. */
  opacity: number
}

/** Either a flat CSS string or a context-aware factory. */
export type MaskFill =
  | string
  | ((ctx: CanvasRenderingContext2D, bbox: MaskBBox) => string | CanvasGradient | CanvasPattern | ResolvedFill)

export interface MaskPalette {
  fill: MaskFill
  stroke: string
}

export const DEFAULT_PALETTE: MaskPalette = {
  fill: 'rgba(255, 61, 10, 0.18)',
  stroke: '#FF3D0A',
}

/**
 * Holographic texture pattern.
 *
 * The reference shop renders holographic with a real iridescent texture
 * image. We do the same — a 512×512 PNG bundled with the app, loaded
 * once at module scope, scaled to the polygon's bbox at draw time.
 *
 * Vite's `?url` query gives us a hashed URL the bundler will inline /
 * fingerprint correctly. The Image element is fired off immediately so
 * by the time the customer picks "Holográfico" in the inspector the
 * pixels are already decoded.
 */
import holographicTextureUrl from '@/assets/textures/holographic.png?url'

let holographicTextureImg: HTMLImageElement | null = null
let holographicTexturePromise: Promise<HTMLImageElement> | null = null

function loadHolographicTexture(): Promise<HTMLImageElement> {
  if (holographicTextureImg) return Promise.resolve(holographicTextureImg)
  if (holographicTexturePromise) return holographicTexturePromise
  holographicTexturePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      holographicTextureImg = img
      resolve(img)
    }
    img.onerror = () => reject(new Error('Failed to load holographic texture'))
    img.src = holographicTextureUrl
  })
  return holographicTexturePromise
}

// Kick the load eagerly so the image is ready by first paint.
void loadHolographicTexture().catch(() => {
  /* logged elsewhere; halo will fall back to a flat color */
})

/**
 * Build a canvas pattern of the holographic texture, sized to roughly the
 * polygon's bounding box (no tiling visible — the swirls appear as a
 * single iridescent wash). Applied at low alpha via globalAlpha at draw
 * time so the artwork stays readable underneath.
 */
function holographicFill(opacity: number) {
  return (ctx: CanvasRenderingContext2D, bbox: MaskBBox): ResolvedFill => {
    const img = holographicTextureImg
    if (!img) {
      // Texture still loading — kick it (in case the eager load failed)
      // and request a redraw once it lands. The flat fallback is brief.
      void loadHolographicTexture()
        .then(() => textureReadyHandlers.forEach((h) => h()))
        .catch(() => {})
      return { style: '#C4B5FD', opacity: opacity * 0.6 }
    }
    // Scale the texture into a helper canvas at the polygon's bbox size so
    // the swirls cover the whole sticker as a single continuous surface
    // (no visible tile repeats). createPattern("no-repeat") then ties one
    // copy to the bbox via setTransform.
    const scaled = document.createElement('canvas')
    const w = Math.max(1, Math.round(bbox.width))
    const h = Math.max(1, Math.round(bbox.height))
    scaled.width = w
    scaled.height = h
    const sctx = scaled.getContext('2d')
    if (!sctx) return { style: '#A78BFA', opacity }
    sctx.drawImage(img, 0, 0, w, h)
    const pattern = ctx.createPattern(scaled, 'no-repeat')
    if (!pattern) return { style: '#A78BFA', opacity }
    const matrix = new DOMMatrix().translateSelf(bbox.x, bbox.y)
    pattern.setTransform(matrix)
    return { style: pattern, opacity }
  }
}

// Handlers to invoke when the holographic texture finishes loading. The
// canvas composable subscribes via onTextureReady so it can redraw the
// mask layer once pixels are available — otherwise a customer who picks
// holographic before the image arrives sees the flat fallback forever.
const textureReadyHandlers: Set<() => void> = new Set()

export function onTextureReady(fn: () => void): () => void {
  textureReadyHandlers.add(fn)
  // Also fire once immediately if already loaded.
  if (holographicTextureImg) fn()
  return () => textureReadyHandlers.delete(fn)
}

// Notify subscribers when the eager load finishes.
void loadHolographicTexture().then(() => {
  textureReadyHandlers.forEach((h) => h())
})

/** Metallic gradient — supports 3+ stops, light → mid → dark, top to bottom. */
function metallicFill(stops: string[], alpha: number) {
  return (ctx: CanvasRenderingContext2D, bbox: MaskBBox): CanvasGradient => {
    const grad = ctx.createLinearGradient(bbox.x, bbox.y, bbox.x, bbox.y + bbox.height)
    const a = alpha.toFixed(2)
    stops.forEach((s, i) => {
      const t = stops.length === 1 ? 0 : i / (stops.length - 1)
      grad.addColorStop(t, withAlpha(s, a))
    })
    return grad
  }
}

/** Convert a `#rrggbb` hex to `rgba(r,g,b,a)`. Defensive for unknown inputs. */
function withAlpha(hex: string, alpha: string): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Higher alphas than the previous pass — the reference shop's halos are
// near-opaque so the gradient reads even when it overlays dark artwork.
// The fill covers the whole polygon (artwork + bleed), so the customer
// sees what the entire sticker will look like through the material.
const MATERIAL_PALETTES: Record<Material, MaskPalette> = {
  vinilo_blanco: {
    fill: metallicFill(['#FFFFFF', '#F3F4F6', '#E5E7EB'], 0.65),
    stroke: '#D1D5DB',
  },
  vinilo_transparente: {
    // Subtle wash — "transparente" should look almost see-through.
    fill: 'rgba(203, 213, 225, 0.30)',
    stroke: '#94A3B8',
  },
  holografico: {
    // Texture is already saturated; lower opacity keeps the artwork
    // readable underneath the iridescent overlay.
    fill: holographicFill(0.55),
    stroke: '#A78BFA',
  },
  holografico_transparente: {
    fill: holographicFill(0.40),
    stroke: '#A78BFA',
  },
  plateado: {
    fill: metallicFill(['#F3F4F6', '#D1D5DB', '#9CA3AF', '#6B7280'], 0.75),
    stroke: '#6B7280',
  },
  dorado: {
    fill: metallicFill(['#FEF3C7', '#FBBF24', '#D97706', '#92400E'], 0.75),
    stroke: '#B45309',
  },
  luminiscente: {
    fill: metallicFill(['#ECFCCB', '#BEF264', '#84CC16'], 0.80),
    stroke: '#65A30D',
  },
  eggshell: {
    fill: metallicFill(['#FFFBEB', '#FEF3C7', '#FDE68A'], 0.70),
    stroke: '#D4B896',
  },
  eggshell_holografico: {
    fill: holographicFill(0.45),
    stroke: '#A5B4FC',
  },
}

export function getMaskPalette(material: Material | '' | null | undefined): MaskPalette {
  if (!material) return DEFAULT_PALETTE
  return MATERIAL_PALETTES[material] ?? DEFAULT_PALETTE
}
