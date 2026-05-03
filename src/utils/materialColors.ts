/**
 * Material → mask textures and colors used in the editor's cut-line halo.
 *
 * Most materials have a real PNG texture (in src/assets/textures/) — same
 * approach the reference shop uses. Materials without a bundled texture
 * fall back to a multi-stop linear gradient so the halo still renders.
 *
 * The texture URLs are also exported (MATERIAL_TEXTURE_URLS) so the
 * order-config MaterialCard swatches can render the same image — keeps
 * picker thumbnails and editor halos visually consistent.
 */
import type { Material } from '@/types/order'

import doradoUrl from '@/assets/textures/dorado.png?url'
import eggshellUrl from '@/assets/textures/eggshell.png?url'
import eggshellHolograficoUrl from '@/assets/textures/eggshell_holografico.png?url'
import holograficoUrl from '@/assets/textures/holografico.png?url'
import holograficoTransparenteUrl from '@/assets/textures/holografico_transparente.png?url'
import plateadoUrl from '@/assets/textures/plateado.png?url'

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
 * Per-material texture URLs (from Vite's `?url` import). Materials without
 * a bundled texture map to undefined and use the gradient fallback.
 */
export const MATERIAL_TEXTURE_URLS: Partial<Record<Material, string>> = {
  holografico: holograficoUrl,
  holografico_transparente: holograficoTransparenteUrl,
  dorado: doradoUrl,
  plateado: plateadoUrl,
  eggshell: eggshellUrl,
  eggshell_holografico: eggshellHolograficoUrl,
  // No texture yet (will use gradient): vinilo_blanco, vinilo_transparente, luminiscente
}

// === Texture loader cache ===

const textureCache = new Map<Material, HTMLImageElement>()
const texturePromises = new Map<Material, Promise<HTMLImageElement>>()
const textureReadyHandlers: Set<() => void> = new Set()

function loadTexture(material: Material): Promise<HTMLImageElement> {
  const cached = textureCache.get(material)
  if (cached) return Promise.resolve(cached)
  const inflight = texturePromises.get(material)
  if (inflight) return inflight
  const url = MATERIAL_TEXTURE_URLS[material]
  if (!url) return Promise.reject(new Error(`No texture for ${material}`))
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      textureCache.set(material, img)
      texturePromises.delete(material)
      textureReadyHandlers.forEach((h) => h())
      resolve(img)
    }
    img.onerror = () => {
      texturePromises.delete(material)
      reject(new Error(`Failed to load texture for ${material}`))
    }
    img.src = url
  })
  texturePromises.set(material, promise)
  return promise
}

/**
 * Eagerly preload all bundled material textures. Called once at module
 * scope so customers don't see the flat fallback in the brief moment
 * between picking a material and the texture finishing decode.
 */
;(Object.keys(MATERIAL_TEXTURE_URLS) as Material[]).forEach((m) => {
  void loadTexture(m).catch(() => {
    /* harmless: the halo falls back to a flat color until the image lands */
  })
})

/**
 * Subscribe to "any texture finished loading" events. The canvas composable
 * uses this to repaint the mask layer once pixels are available.
 *
 * Returns an unsubscribe function.
 */
export function onTextureReady(fn: () => void): () => void {
  textureReadyHandlers.add(fn)
  // Fire once immediately if any textures are already loaded.
  if (textureCache.size > 0) fn()
  return () => textureReadyHandlers.delete(fn)
}

// === Texture-pattern fill factory ===

/**
 * Build a canvas-pattern fill from the material's bundled texture.
 * Scales the image to the polygon's bbox so the texture covers the whole
 * sticker as one continuous surface (no visible tile repeats).
 *
 * If the texture isn't loaded yet, returns a flat fallback color and
 * triggers a load — `onTextureReady` will fire once the image arrives so
 * the canvas can repaint with the real texture.
 */
function textureFill(material: Material, opacity: number, fallback: string) {
  return (ctx: CanvasRenderingContext2D, bbox: MaskBBox): ResolvedFill => {
    const img = textureCache.get(material)
    if (!img) {
      void loadTexture(material).catch(() => {})
      return { style: fallback, opacity: opacity * 0.6 }
    }
    const scaled = document.createElement('canvas')
    const w = Math.max(1, Math.round(bbox.width))
    const h = Math.max(1, Math.round(bbox.height))
    scaled.width = w
    scaled.height = h
    const sctx = scaled.getContext('2d')
    if (!sctx) return { style: fallback, opacity }
    sctx.drawImage(img, 0, 0, w, h)
    const pattern = ctx.createPattern(scaled, 'no-repeat')
    if (!pattern) return { style: fallback, opacity }
    const matrix = new DOMMatrix().translateSelf(bbox.x, bbox.y)
    pattern.setTransform(matrix)
    return { style: pattern, opacity }
  }
}

// === Gradient fallback for materials without a bundled texture ===

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

function withAlpha(hex: string, alpha: string): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const MATERIAL_PALETTES: Record<Material, MaskPalette> = {
  vinilo_blanco: {
    // No bundled texture — gradient stays.
    fill: metallicFill(['#FFFFFF', '#F3F4F6', '#E5E7EB'], 0.65),
    stroke: '#D1D5DB',
  },
  vinilo_transparente: {
    // Subtle wash — "transparente" should look almost see-through.
    fill: 'rgba(203, 213, 225, 0.30)',
    stroke: '#94A3B8',
  },
  holografico: {
    fill: textureFill('holografico', 0.55, '#C4B5FD'),
    stroke: '#A78BFA',
  },
  holografico_transparente: {
    fill: textureFill('holografico_transparente', 0.45, '#C4B5FD'),
    stroke: '#A78BFA',
  },
  plateado: {
    fill: textureFill('plateado', 0.65, '#9CA3AF'),
    stroke: '#6B7280',
  },
  dorado: {
    fill: textureFill('dorado', 0.65, '#D4AF37'),
    stroke: '#B45309',
  },
  luminiscente: {
    // No bundled texture yet — gradient stays.
    fill: metallicFill(['#ECFCCB', '#BEF264', '#84CC16'], 0.80),
    stroke: '#65A30D',
  },
  eggshell: {
    fill: textureFill('eggshell', 0.65, '#D4B896'),
    stroke: '#D4B896',
  },
  eggshell_holografico: {
    fill: textureFill('eggshell_holografico', 0.55, '#A5B4FC'),
    stroke: '#A5B4FC',
  },
}

export function getMaskPalette(material: Material | '' | null | undefined): MaskPalette {
  if (!material) return DEFAULT_PALETTE
  return MATERIAL_PALETTES[material] ?? DEFAULT_PALETTE
}
