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

/** Either a flat CSS string or a context-aware gradient factory. */
export type MaskFill = string | ((ctx: CanvasRenderingContext2D, bbox: MaskBBox) => CanvasGradient | string)

export interface MaskPalette {
  fill: MaskFill
  stroke: string
}

export const DEFAULT_PALETTE: MaskPalette = {
  fill: 'rgba(255, 61, 10, 0.18)',
  stroke: '#FF3D0A',
}

/**
 * Build a holographic-style gradient: cyan → violet → pink → cyan,
 * rotated through the polygon's bounding box. Same color stops as the
 * `bg-holographic` Tailwind class used by MaterialCard so the halo
 * matches the swatch.
 */
function holographicFill(alpha: number) {
  return (ctx: CanvasRenderingContext2D, bbox: MaskBBox): CanvasGradient => {
    // Diagonal gradient — top-left to bottom-right — covers the polygon.
    const grad = ctx.createLinearGradient(
      bbox.x,
      bbox.y,
      bbox.x + bbox.width,
      bbox.y + bbox.height,
    )
    const a = alpha.toFixed(2)
    grad.addColorStop(0.0, `rgba(125, 211, 252, ${a})`)   // cyan-300
    grad.addColorStop(0.33, `rgba(196, 181, 253, ${a})`)  // violet-300
    grad.addColorStop(0.66, `rgba(244, 114, 182, ${a})`)  // pink-400
    grad.addColorStop(1.0, `rgba(125, 211, 252, ${a})`)   // back to cyan
    return grad
  }
}

/** Metallic linear gradient — light → mid → dark, top to bottom. */
function metallicFill(stops: [string, string, string], alpha: number) {
  return (ctx: CanvasRenderingContext2D, bbox: MaskBBox): CanvasGradient => {
    const grad = ctx.createLinearGradient(bbox.x, bbox.y, bbox.x, bbox.y + bbox.height)
    const a = alpha.toFixed(2)
    grad.addColorStop(0.0, withAlpha(stops[0], a))
    grad.addColorStop(0.5, withAlpha(stops[1], a))
    grad.addColorStop(1.0, withAlpha(stops[2], a))
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

const MATERIAL_PALETTES: Record<Material, MaskPalette> = {
  vinilo_blanco: {
    fill: metallicFill(['#FFFFFF', '#E5E7EB', '#D1D5DB'], 0.55),
    stroke: '#D1D5DB',
  },
  vinilo_transparente: {
    fill: 'rgba(148, 163, 184, 0.25)', // flat — "transparente" reads as plain
    stroke: '#94A3B8',
  },
  holografico: {
    fill: holographicFill(0.45),
    stroke: '#A78BFA', // violet — average of the holographic spectrum
  },
  holografico_transparente: {
    fill: holographicFill(0.30),
    stroke: '#A78BFA',
  },
  plateado: {
    fill: metallicFill(['#E5E7EB', '#9CA3AF', '#4B5563'], 0.55),
    stroke: '#6B7280',
  },
  dorado: {
    fill: metallicFill(['#FDE68A', '#F59E0B', '#92400E'], 0.50),
    stroke: '#B45309',
  },
  luminiscente: {
    fill: metallicFill(['#D9F99D', '#A3E635', '#65A30D'], 0.55),
    stroke: '#65A30D',
  },
  eggshell: {
    fill: metallicFill(['#FEF3C7', '#FDE68A', '#FCD34D'], 0.55),
    stroke: '#D4B896',
  },
  eggshell_holografico: {
    fill: holographicFill(0.40),
    stroke: '#A5B4FC',
  },
}

export function getMaskPalette(material: Material | '' | null | undefined): MaskPalette {
  if (!material) return DEFAULT_PALETTE
  return MATERIAL_PALETTES[material] ?? DEFAULT_PALETTE
}
