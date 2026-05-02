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
 * Holographic gradient — green-mint → cyan → white → pink → peach.
 * 5 saturated stops on the diagonal mimic the iridescent oil-slick look
 * of physical holographic vinyl. Compare to the reference shop's editor:
 * the bleed clearly cycles through several colors edge-to-edge, not
 * just two. We don't have a real holographic.png pattern asset yet, so
 * the linear gradient is the best in-canvas approximation.
 */
function holographicFill(alpha: number) {
  return (ctx: CanvasRenderingContext2D, bbox: MaskBBox): CanvasGradient => {
    const grad = ctx.createLinearGradient(
      bbox.x,
      bbox.y,
      bbox.x + bbox.width,
      bbox.y + bbox.height,
    )
    const a = alpha.toFixed(2)
    grad.addColorStop(0.0, `rgba(110, 231, 183, ${a})`)  // emerald-300 (mint)
    grad.addColorStop(0.25, `rgba(125, 211, 252, ${a})`) // sky-300 (cyan)
    grad.addColorStop(0.5, `rgba(255, 255, 255, ${a})`)  // white highlight
    grad.addColorStop(0.75, `rgba(244, 114, 182, ${a})`) // pink-400
    grad.addColorStop(1.0, `rgba(253, 186, 116, ${a})`)  // orange-300 (peach)
    return grad
  }
}

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
    fill: holographicFill(0.85),
    stroke: '#A78BFA',
  },
  holografico_transparente: {
    fill: holographicFill(0.55),
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
    fill: holographicFill(0.65),
    stroke: '#A5B4FC',
  },
}

export function getMaskPalette(material: Material | '' | null | undefined): MaskPalette {
  if (!material) return DEFAULT_PALETTE
  return MATERIAL_PALETTES[material] ?? DEFAULT_PALETTE
}
