import api from './api'
import type { OrderFile, OrderFileKind } from '@/types/order'
import type { Paginated } from '@/types/api'

export const filesService = {
  async list(orderUuid: string): Promise<Paginated<OrderFile>> {
    const response = await api.get(`/orders/${orderUuid}/files/`)
    return response.data
  },

  /**
   * Upload a file slot. unique_together(order, kind) on the backend means
   * if a file of this kind already exists, the upload returns 400 with an
   * IntegrityError — the caller should DELETE the existing one first
   * (filesService.delete) and re-upload.
   */
  async upload(orderUuid: string, kind: OrderFileKind, file: File | Blob): Promise<OrderFile> {
    const form = new FormData()
    form.append('kind', kind)
    // The backend serializer reads exactly `file` — not `image`, not `upload`.
    form.append('file', file, file instanceof File ? file.name : `${kind}.png`)
    const response = await api.post(`/orders/${orderUuid}/files/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },

  async delete(orderUuid: string, fileUuid: string): Promise<void> {
    await api.delete(`/orders/${orderUuid}/files/${fileUuid}/`)
  },
}
