import api from './api'
import type { Paginated } from '@/types/api'
import type {
  CheckoutResponse,
  CreateCatalogOrderPayload,
  Order,
  OrderUpdatePayload,
  PriceQuoteRequest,
  PriceQuoteResponse,
  SmartCutResponse,
} from '@/types/order'

export const ordersService = {
  // === CRUD ===

  async list(): Promise<Paginated<Order>> {
    const response = await api.get('/orders/')
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

  // === AI background removal ===

  /**
   * Run "Recorte inteligente" — sync server-side rembg on the order's
   * `original` file. Returns a polygon in image-natural pixels.
   * Customer-blocking: ~3-5 s round-trip including the model inference.
   * The server allows it on any order status (read-only operation).
   */
  async smartCut(uuid: string): Promise<SmartCutResponse> {
    const response = await api.post(`/orders/${uuid}/smart-cut/`)
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
