/**
 * Order lifecycle. Snake_case strings on the wire — match exactly.
 * Translate for display via STATUS_LABELS, never store the translation as the value.
 */
export type OrderStatus =
  | 'draft'
  | 'placed'
  | 'paid'
  | 'in_production'
  | 'shipped'
  | 'delivered'
  | 'cancelled'

/**
 * Sticker materials sold by the shop. Keys match the backend enum exactly.
 * Display labels (the Spanish names) come from MATERIAL_LABELS below.
 */
export type Material =
  | 'vinilo_blanco'
  | 'vinilo_transparente'
  | 'holografico'
  | 'holografico_transparente'
  | 'plateado'
  | 'dorado'
  | 'luminiscente'
  | 'eggshell'
  | 'eggshell_holografico'

export const MATERIAL_LABELS: Record<Material, string> = {
  vinilo_blanco: 'Vinilo blanco',
  vinilo_transparente: 'Vinilo transparente',
  holografico: 'Vinilo holográfico',
  holografico_transparente: 'Vinilo holográfico transparente',
  plateado: 'Vinilo plateado',
  dorado: 'Vinilo dorado',
  luminiscente: 'Vinilo luminiscente',
  eggshell: 'Vinilo eggshell',
  eggshell_holografico: 'Vinilo eggshell holográfico',
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Borrador',
  placed: 'Realizado',
  paid: 'Pagado',
  in_production: 'En producción',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

/** Sizing constraints — must match backend (apps/orders/models.py). */
export const MIN_DIMENSION_MM = 25
export const DIMENSION_STEP_MM = 5
export const MIN_QUANTITY = 20
export const MAX_QUANTITY = 100_000

export type OrderFileKind = 'original' | 'die_cut_mask'
// 'relief_mask' is reserved for when drawn-relief lands; not in M2.

export interface OrderFile {
  uuid: string
  kind: OrderFileKind
  file: string // URL on the backend's media server
  mime_type: string
  size_bytes: number
  created_at: string
}

export interface Order {
  uuid: string
  status: OrderStatus

  // Sticker spec
  material: Material | ''
  width_mm: number
  height_mm: number
  quantity: number
  with_design_service: boolean
  with_varnish: boolean
  with_relief: boolean
  relief_note: string

  // Shipping (flat columns — single shipping address per order)
  recipient_name: string
  street_line_1: string
  street_line_2: string
  city: string
  postal_code: string
  country: string

  // Money
  total_amount_cents: number
  total_eur: string // pre-formatted "110.00" — for display
  currency: string

  // Stripe
  stripe_payment_intent_id: string

  // Files
  files: OrderFile[]

  // Lifecycle timestamps
  created_at: string
  updated_at: string
  placed_at: string | null
  paid_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
}

/**
 * Patch payload accepted by PATCH /orders/{uuid}/ while status=draft.
 * Strict subset of Order — server rejects unknown fields.
 */
export interface OrderUpdatePayload {
  material?: Material
  width_mm?: number
  height_mm?: number
  quantity?: number
  with_design_service?: boolean
  with_varnish?: boolean
  with_relief?: boolean
  relief_note?: string
  recipient_name?: string
  street_line_1?: string
  street_line_2?: string
  city?: string
  postal_code?: string
  country?: string
}

export interface PriceQuoteRequest {
  material: Material
  width_mm: number
  height_mm: number
  quantity: number
  with_design_service?: boolean
  with_varnish?: boolean
  with_relief?: boolean
}

export interface PriceQuoteResponse {
  total_amount_cents: number
  total_eur: string
  currency: string
}

export interface CheckoutResponse {
  client_secret: string
  payment_intent_id: string
  amount_cents: number
  currency: string
}
