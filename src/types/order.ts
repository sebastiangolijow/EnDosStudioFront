import type { ProductRef } from './product'

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

/**
 * Cut shape — drives whether the editor is part of the customer flow.
 * `contorneado` follows the artwork outline (auto-cut runs in the editor);
 * the other three are geometric primitives sized from width × height.
 * Customers picking anything other than `contorneado` skip the editor.
 */
export type Shape = 'contorneado' | 'cuadrado' | 'circulo' | 'redondeadas'

export const SHAPE_LABELS: Record<Shape, string> = {
  contorneado: 'Corte contorneado',
  cuadrado: 'Cuadrado',
  circulo: 'Círculo',
  redondeadas: 'Esquinas redondeadas',
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

/** File kinds we can upload to an order.
 *
 * `original`         — customer's source design (uploaded in step 1)
 * `die_cut_mask`     — the cut polygon image the editor produces (uploaded
 *                      on Continuar from the editor)
 * `preview_composite`— PNG snapshot of the editor's final canvas view
 *                      (artwork + halo + material FX as the customer
 *                      saw it). Uploaded on Continuar so the admin can
 *                      see exactly what the customer designed.
 *
 * `cut_path` (server-generated SVG) is read-only from the frontend — the
 * backend creates it at transition_to_paid. Not in this union because
 * we never upload it.
 */
export type OrderFileKind = 'original' | 'die_cut_mask' | 'preview_composite'
// 'relief_mask' is reserved for when drawn-relief lands; not in M2.

/**
 * Order kind discriminator (M3a).
 *  - 'sticker': the M2 custom-sticker flow (editor + cut-path + area pricing).
 *  - 'catalog': a single non-sticker product purchase (skips editor entirely).
 * Mixed cart with both is M3b.
 */
export type OrderKind = 'sticker' | 'catalog'

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
  kind: OrderKind
  status: OrderStatus

  // Sticker spec — set when kind='sticker'; empty/zero defaults when kind='catalog'.
  material: Material | ''
  shape: Shape
  width_mm: number
  height_mm: number
  quantity: number
  with_relief: boolean
  with_tinta_blanca: boolean
  with_barniz_brillo: boolean
  with_barniz_opaco: boolean
  relief_note: string

  // Catalog — set when kind='catalog'; null/0 when kind='sticker'.
  product: string | null // UUID
  product_quantity: number
  product_detail: ProductRef | null // nested embed for the catalog summary

  // Shipping (flat columns — single shipping address per order)
  recipient_name: string
  street_line_1: string
  street_line_2: string
  city: string
  postal_code: string
  country: string

  // Customer (read-only, populated by the backend serializer for the
  // admin orders screen). Empty strings when created_by is null
  // (SET_NULL'd by a user delete).
  customer_email: string
  customer_name: string

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
  kind?: OrderKind
  // Sticker
  material?: Material
  shape?: Shape
  width_mm?: number
  height_mm?: number
  quantity?: number
  with_relief?: boolean
  with_tinta_blanca?: boolean
  with_barniz_brillo?: boolean
  with_barniz_opaco?: boolean
  relief_note?: string
  // Catalog
  product?: string | null
  product_quantity?: number
  // Shipping
  recipient_name?: string
  street_line_1?: string
  street_line_2?: string
  city?: string
  postal_code?: string
  country?: string
}

/** POST /orders/ payload — minimal. */
export interface CreateCatalogOrderPayload {
  kind: 'catalog'
  product: string // UUID
  product_quantity: number
}

/** Query params accepted by GET /orders/.
 *  Used both by customer list views (sparse — usually no params) and
 *  the admin orders screen (heavy filter/search/sort). All fields are
 *  optional; the service skips undefined/empty values. */
export interface OrderListParams {
  status?: OrderStatus
  status_in?: string // comma-separated, e.g. "paid,in_production"
  kind?: OrderKind
  search?: string // icontains across uuid + customer fields + recipient
  ordering?: string // e.g. "-placed_at"
  created_after?: string // ISO datetime
  created_before?: string
  placed_after?: string
  placed_before?: string
  page?: number
  page_size?: number // capped at 100 server-side
}

export interface PriceQuoteRequest {
  material: Material
  width_mm: number
  height_mm: number
  quantity: number
  with_relief?: boolean
  with_tinta_blanca?: boolean
  with_barniz_brillo?: boolean
  with_barniz_opaco?: boolean
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

/**
 * Smart-cut (AI background removal) response.
 *
 * Returned by POST /api/v1/orders/{uuid}/smart-cut/. Polygon points are
 * in image-natural pixels (same coordinate system as `setMask` expects).
 * `artwork_points` is identical to `points` in the current backend
 * version (no server-side bleed offset); the field is reserved for M3b
 * when bleed-margin offsetting may move to the backend.
 *
 * Snake_case on the wire matches the rest of the file (e.g.
 * `total_amount_cents`, `artwork_points`). Consumers read
 * `result.artwork_points` directly — no camel conversion in the
 * service layer.
 */
export interface SmartCutPoint {
  kind: 'image'
  x: number
  y: number
}
export interface SmartCutResponse {
  kind: 'ok' | 'no-contour-found'
  points: SmartCutPoint[]
  artwork_points: SmartCutPoint[]
  area_px: number
  /**
   * The rembg-cleaned RGBA image as a base64 PNG data URL. Same pixel
   * dimensions as the source `original`. The frontend swaps it in as the
   * canvas's base layer when smart-cut is active so margin expansion
   * shows transparent ring (or material halo) in the bleed area instead
   * of truncated bits of the source PNG. `null` on no-contour-found.
   * Typical size: 50-200 KB inline.
   */
  cleaned_image_data_url: string | null
}
