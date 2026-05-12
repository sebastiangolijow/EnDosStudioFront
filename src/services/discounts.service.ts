import api from './api'
import type { Paginated } from '@/types/api'

/** Promo / discount code admin surface. Staff-only — customers don't
 *  list or create discounts; they just submit a code via
 *  ordersService.applyDiscount.
 *
 *  Mirrors the backend's apps.discounts.Discount model: code is stored
 *  uppercase, percent_off is an integer 1..100, is_enabled toggles
 *  visibility without losing the audit trail.
 */
export interface Discount {
  uuid: string
  code: string
  percent_off: number
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface DiscountWritePayload {
  code: string
  percent_off: number
  is_enabled?: boolean
}

export const discountsService = {
  async list(): Promise<Paginated<Discount>> {
    const response = await api.get('/discounts/')
    return response.data
  },

  async create(payload: DiscountWritePayload): Promise<Discount> {
    const response = await api.post('/discounts/', payload)
    return response.data
  },

  async update(uuid: string, payload: Partial<DiscountWritePayload>): Promise<Discount> {
    const response = await api.patch(`/discounts/${uuid}/`, payload)
    return response.data
  },

  async remove(uuid: string): Promise<void> {
    await api.delete(`/discounts/${uuid}/`)
  },
}
