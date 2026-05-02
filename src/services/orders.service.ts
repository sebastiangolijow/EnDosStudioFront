import api from './api'
import type { Paginated } from '@/types/api'
import type {
  CheckoutResponse,
  Order,
  OrderUpdatePayload,
  PriceQuoteRequest,
  PriceQuoteResponse,
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
   * Creates an empty draft owned by the requesting user. No body needed —
   * the backend treats `POST /orders/` with `{}` as "give me a fresh draft".
   */
  async createDraft(): Promise<Order> {
    const response = await api.post('/orders/', {})
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

  // === Pricing preview (no DB write) ===

  async quote(request: PriceQuoteRequest): Promise<PriceQuoteResponse> {
    const response = await api.get('/orders/quote/', {
      params: {
        material: request.material,
        width_mm: request.width_mm,
        height_mm: request.height_mm,
        quantity: request.quantity,
        with_design_service: request.with_design_service ?? false,
        with_varnish: request.with_varnish ?? false,
        with_relief: request.with_relief ?? false,
      },
    })
    return response.data
  },
}
