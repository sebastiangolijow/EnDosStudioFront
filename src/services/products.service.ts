import api from './api'
import type { Paginated } from '@/types/api'
import type { Product, ProductWritePayload } from '@/types/product'

/**
 * Public product methods don't need auth — backend allows anonymous
 * list/retrieve so the catalog is browsable before signup. Admin
 * methods require staff JWT (the axios interceptor already attaches
 * Authorization when present).
 */
function buildFormData(payload: ProductWritePayload): FormData {
  const fd = new FormData()
  fd.set('name', payload.name)
  if (payload.description !== undefined) fd.set('description', payload.description)
  fd.set('price_cents', String(payload.price_cents))
  fd.set('stock_quantity', String(payload.stock_quantity))
  if (payload.is_active !== undefined) fd.set('is_active', String(payload.is_active))
  if (payload.image instanceof File) fd.set('image', payload.image)
  return fd
}

export const productsService = {
  // === Public ===

  async list(): Promise<Paginated<Product>> {
    const response = await api.get('/products/')
    return response.data
  },

  async getBySlug(slug: string): Promise<Product> {
    const response = await api.get(`/products/${slug}/`)
    return response.data
  },

  // === Admin (staff JWT required) ===

  /** Same endpoint as list; staff sees inactive products too. */
  async adminList(): Promise<Paginated<Product>> {
    const response = await api.get('/products/')
    return response.data
  },

  async adminCreate(payload: ProductWritePayload): Promise<Product> {
    const response = await api.post('/products/', buildFormData(payload), {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },

  /** PATCH by slug. Submit only the fields you want to change.
   *  Pass `image: null` to keep the existing image; pass a `File` to replace it.
   */
  async adminUpdate(slug: string, payload: Partial<ProductWritePayload>): Promise<Product> {
    const fd = new FormData()
    if (payload.name !== undefined) fd.set('name', payload.name)
    if (payload.description !== undefined) fd.set('description', payload.description)
    if (payload.price_cents !== undefined) fd.set('price_cents', String(payload.price_cents))
    if (payload.stock_quantity !== undefined) {
      fd.set('stock_quantity', String(payload.stock_quantity))
    }
    if (payload.is_active !== undefined) fd.set('is_active', String(payload.is_active))
    if (payload.image instanceof File) fd.set('image', payload.image)

    const response = await api.patch(`/products/${slug}/`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },

  async adminDelete(slug: string): Promise<void> {
    await api.delete(`/products/${slug}/`)
  },
}
