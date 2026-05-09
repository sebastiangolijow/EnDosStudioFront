/**
 * Catalog product types. Mirrors apps.products.serializers.ProductSerializer
 * on the backend. The price comes pre-formatted as `price_eur` ("15.00")
 * for display; never compute `price_cents / 100` on the frontend (float
 * precision loss).
 */

export interface Product {
  uuid: string
  name: string
  slug: string
  description: string
  price_cents: number
  price_eur: string // pre-formatted "15.00"
  stock_quantity: number
  image: string | null // URL on the backend's media server
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Tiny embed shape used inside Order.product_detail. The backend's
 * ProductRefSerializer returns just the fields a checkout/order summary
 * needs without forcing a second API call.
 */
export interface ProductRef {
  uuid: string
  name: string
  slug: string
  image: string | null
  price_cents: number
  price_eur: string
}

/** Multipart form payload for admin create/update. */
export interface ProductWritePayload {
  name: string
  description?: string
  price_cents: number
  stock_quantity: number
  image?: File | null
  is_active?: boolean
}
