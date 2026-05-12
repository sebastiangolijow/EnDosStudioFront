import api from './api'
import type { Paginated } from '@/types/api'
import type { User } from '@/types/auth'

/**
 * Admin users API — staff-only. Powers the /admin/users page where
 * the shop owner toggles per-user flags like `can_reserve_orders`.
 *
 * Public auth endpoints (login, me, register) live in auth.service.ts.
 */

export interface AdminUserListParams {
  search?: string
  can_reserve_orders?: boolean
  role?: 'admin' | 'shop_staff' | 'customer'
  page?: number
  page_size?: number
}

export const usersService = {
  async adminList(params: AdminUserListParams = {}): Promise<Paginated<User>> {
    const qp: Record<string, string | number> = {}
    if (params.search) qp.search = params.search
    if (params.can_reserve_orders !== undefined) {
      qp.can_reserve_orders = String(params.can_reserve_orders)
    }
    if (params.role) qp.role = params.role
    if (params.page) qp.page = params.page
    if (params.page_size) qp.page_size = params.page_size
    const response = await api.get('/users/', { params: qp })
    return response.data
  },

  /** PATCH /users/{uuid}/ — only the can_reserve_orders flag is
   *  writable today. Backend silently drops other fields. */
  async adminSetCanReserve(uuid: string, canReserve: boolean): Promise<User> {
    const response = await api.patch(`/users/${uuid}/`, {
      can_reserve_orders: canReserve,
    })
    return response.data
  },
}
