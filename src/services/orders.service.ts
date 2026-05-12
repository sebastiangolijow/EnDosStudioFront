import api from './api'
import type { Paginated } from '@/types/api'
import type {
  CheckoutResponse,
  CreateCatalogOrderPayload,
  Order,
  OrderListParams,
  OrderUpdatePayload,
  PriceQuoteRequest,
  PriceQuoteResponse,
  SmartCutResponse,
} from '@/types/order'

export const ordersService = {
  // === CRUD ===

  /**
   * GET /orders/ with optional filter/search/ordering query params.
   *
   * Customers calling without params get their own orders (queryset is
   * role-scoped server-side). The admin orders screen uses every param:
   *   - status         exact match (paid | in_production | …)
   *   - status_in      comma-separated list (e.g. "paid,in_production")
   *   - kind           sticker | catalog
   *   - search         icontains across uuid + customer email/name + recipient
   *   - ordering       e.g. "-placed_at" (default backend ordering: -created_at)
   *   - created_after  ISO datetime
   *   - created_before ISO datetime
   *   - placed_after   ISO datetime
   *   - placed_before  ISO datetime
   *   - page           1-based pagination
   *   - page_size      capped at 100 server-side
   *
   * Empty/undefined params are skipped so axios doesn't serialize them
   * as `?key=` (which the backend treats as "filter by empty string").
   */
  async list(params: OrderListParams = {}): Promise<Paginated<Order>> {
    const cleanParams: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        cleanParams[k] = v as string | number
      }
    }
    const response = await api.get('/orders/', { params: cleanParams })
    return response.data
  },

  async retrieve(uuid: string): Promise<Order> {
    const response = await api.get(`/orders/${uuid}/`)
    return response.data
  },

  /**
   * Creates an empty sticker draft owned by the requesting user. No body
   * needed — the backend treats `POST /orders/` with `{}` as "give me a
   * fresh sticker draft" (kind defaults to 'sticker' server-side).
   */
  async createDraft(): Promise<Order> {
    const response = await api.post('/orders/', {})
    return response.data
  },

  /**
   * Creates a catalog draft pre-populated with the chosen product + qty.
   * Customer is redirected to /checkout/{uuid} to fill shipping next.
   */
  async createCatalogOrder(payload: {
    product: string
    product_quantity: number
  }): Promise<Order> {
    const body: CreateCatalogOrderPayload = {
      kind: 'catalog',
      product: payload.product,
      product_quantity: payload.product_quantity,
    }
    const response = await api.post('/orders/', body)
    return response.data
  },

  /**
   * PATCH only — only allowed while status='draft'. Returns 409 if the
   * order has been placed. Field names match OrderUpdatePayload exactly.
   */
  async update(uuid: string, patch: OrderUpdatePayload): Promise<Order> {
    const response = await api.patch(`/orders/${uuid}/`, patch)
    return response.data
  },

  // === Lifecycle transitions ===

  /** draft → placed. Validates required fields server-side; computes total. */
  async place(uuid: string): Promise<Order> {
    const response = await api.post(`/orders/${uuid}/place/`)
    return response.data
  },

  /**
   * Creates a Stripe PaymentIntent for a placed order.
   * Returns the client_secret the frontend hands to Stripe.js.
   */
  async checkout(uuid: string): Promise<CheckoutResponse> {
    const response = await api.post(`/orders/${uuid}/checkout/`)
    return response.data
  },

  /** Customer-only. Allowed only while status ∈ {draft, placed} in M2. */
  async cancel(uuid: string, reason?: string): Promise<Order> {
    const response = await api.post(`/orders/${uuid}/cancel/`, reason ? { reason } : {})
    return response.data
  },

  /** Customer-only. shipped → delivered. */
  async deliver(uuid: string): Promise<Order> {
    const response = await api.post(`/orders/${uuid}/deliver/`)
    return response.data
  },

  /** Staff-only. placed → paid.
   *
   * Manual fallback for shop owners handling payment out-of-band (bank
   * transfer, cash on pickup). Stripe webhook drives the same
   * transition automatically when payment confirms; this is the
   * admin's escape hatch. */
  async markPaid(uuid: string): Promise<Order> {
    const response = await api.post(`/orders/${uuid}/mark-paid/`)
    return response.data
  },

  /** Staff-only. paid → in_production. */
  async startProduction(uuid: string): Promise<Order> {
    const response = await api.post(`/orders/${uuid}/start-production/`)
    return response.data
  },

  /** Staff-only. in_production → shipped. */
  async ship(uuid: string): Promise<Order> {
    const response = await api.post(`/orders/${uuid}/ship/`)
    return response.data
  },

  /** Staff-only. Force any status → any status, bypassing the usual
   *  transition guards. When transitioning to 'shipped' with
   *  shipping_tracking_code set, the backend also sends a notification
   *  email to the customer. */
  async adminSetStatus(
    uuid: string,
    payload: {
      status: string
      shipping_carrier?: string
      shipping_tracking_code?: string
      shipping_eta_date?: string | null
    },
  ): Promise<Order> {
    const response = await api.post(`/orders/${uuid}/admin-set-status/`, payload)
    return response.data
  },

  /** Staff-only. Distinct shipping_carrier values from past orders —
   *  drives the autosuggest in the "Marcar enviado" popup. */
  async listShippingCarriers(): Promise<string[]> {
    const response = await api.get('/orders/shipping-carriers/')
    return response.data.results ?? []
  },

  // === AI background removal ===

  /**
   * Run "Recorte inteligente" — sync server-side rembg on the order's
   * `original` file. Returns a polygon in image-natural pixels, dilated
   * by `marginMm` of bleed and Gaussian-smoothed for cuttability per
   * `smoothness` (1-10). Customer-blocking: ~2-3 s on a warm rembg
   * session, ~25-40 s on the first call after a backend boot.
   *
   * Per-call timeout overrides the api default (30 s) → 90 s for the
   * cold-start case. Without this override the first call always axios-
   * timeouts even though the server eventually returns 200 — the
   * customer sees a confusing "Falló" toast.
   *
   * The server allows this on any order status (read-only operation).
   * The server clamps marginMm to a 5 mm minimum (printable floor); pass
   * any positive integer. smoothness must be 1-10.
   */
  async smartCut(
    uuid: string,
    marginMm = 15,
    smoothness = 5,
  ): Promise<SmartCutResponse> {
    const response = await api.post(
      `/orders/${uuid}/smart-cut/`,
      { margin_mm: marginMm, smoothness },
      { timeout: 90_000 },
    )
    return response.data
  },

  // === Pricing preview (no DB write) ===

  async quote(request: PriceQuoteRequest): Promise<PriceQuoteResponse> {
    const response = await api.get('/orders/quote/', {
      params: {
        material: request.material,
        width_mm: request.width_mm,
        height_mm: request.height_mm,
        quantity: request.quantity,
        with_relief: request.with_relief ?? false,
        with_tinta_blanca: request.with_tinta_blanca ?? false,
        with_barniz_brillo: request.with_barniz_brillo ?? false,
        with_barniz_opaco: request.with_barniz_opaco ?? false,
      },
    })
    return response.data
  },
}
