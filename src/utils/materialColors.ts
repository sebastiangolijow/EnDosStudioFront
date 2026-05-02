/**
 * Material → mask colors used in the editor's cut-line halo.
 *
 * `fill` is the translucent halo (the bleed area inside the cut line).
 * `stroke` is the cut line itself.
 *
 * Picked to roughly match each material's real-world appearance so the
 * customer can preview "what will the surrounding bleed look like in
 * holographic vs. dorado vs. plateado". When no material is selected the
 * default orange (the brand primary) is used — same as before.
 *
 * Single-color (linear) approximations: the canvas API doesn't support a
 * "live holographic gradient" without a full-bitmap fill, so we pick a
 * representative tone. If/when the editor renders the cut line over a real
 * material-texture preview, the halo color stops mattering visually.
 */
import type { Material } from '@/types/order'

export interface MaskPalette {
  /** Translucent fill for the bleed area, as a CSS rgba/hex string. */
  fill: string
  /** Solid color for the cut line stroke. */
  stroke: string
}

export const DEFAULT_PALETTE: MaskPalette = {
  fill: 'rgba(255, 61, 10, 0.15)',
  stroke: '#FF3D0A',
}

const MATERIAL_PALETTES: Record<Material, MaskPalette> = {
  vinilo_blanco: { fill: 'rgba(255, 255, 255, 0.45)', stroke: '#E5E7EB' },
  vinilo_transparente: { fill: 'rgba(148, 163, 184, 0.25)', stroke: '#94A3B8' },
  holografico: { fill: 'rgba(140, 220, 230, 0.45)', stroke: '#7DD3FC' },
  holografico_transparente: { fill: 'rgba(140, 220, 230, 0.30)', stroke: '#67E8F9' },
  plateado: { fill: 'rgba(180, 180, 190, 0.55)', stroke: '#9CA3AF' },
  dorado: { fill: 'rgba(245, 200, 80, 0.45)', stroke: '#D4AF37' },
  luminiscente: { fill: 'rgba(190, 240, 130, 0.55)', stroke: '#A3E635' },
  eggshell: { fill: 'rgba(245, 230, 200, 0.55)', stroke: '#D4B896' },
  eggshell_holografico: { fill: 'rgba(190, 200, 230, 0.45)', stroke: '#A5B4FC' },
}

export function getMaskPalette(material: Material | '' | null | undefined): MaskPalette {
  if (!material) return DEFAULT_PALETTE
  return MATERIAL_PALETTES[material] ?? DEFAULT_PALETTE
}
