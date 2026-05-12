/**
 * Catalog product types. Mirrors apps.products.serializers.ProductSerializer
 * on the backend. The price comes pre-formatted as `price_eur` ("15.00")
 * for display; never compute `price_cents / 100` on the frontend (float
 * precision loss).
 */

export interface CategoryRef {
  uuid: string
  name: string
  slug: string
}

export interface Product {
  uuid: string
  name: string
  slug: string
  description: string
  price_cents: number
  price_eur: string // pre-formatted "15.00"
  /** Optional discounted price. When non-null the customer pays this
   *  instead of price_cents; UI shows price_eur with a strikethrough. */
  sale_price_cents: number | null
  sale_price_eur: string | null
  /** Whichever price the customer actually pays — sale if set, else
   *  regular. Backend-computed so the math stays in one place. */
  effective_price_cents: number
  effective_price_eur: string
  /** Optional. Captured for future weight-based shipping; not surfaced
   *  in the customer UI today. */
  weight_grams: number | null
  category: CategoryRef | null
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
  sale_price_cents: number | null
  sale_price_eur: string | null
  effective_price_cents: number
  effective_price_eur: string
}

/** Multipart form payload for admin create/update. `category` is a
 *  free-text name; the backend creates or reuses a Category row by slug. */
export interface ProductWritePayload {
  name: string
  description?: string
  price_cents: number
  sale_price_cents?: number | null
  stock_quantity: number
  weight_grams?: number | null
  category?: string
  image?: File | null
  is_active?: boolean
}
