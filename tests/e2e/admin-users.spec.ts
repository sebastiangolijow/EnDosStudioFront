/**
 * Admin users screen — manages the can_reserve_orders whitelist.
 *
 * Coverage:
 *   - Customer cannot reach /admin/users (router guard).
 *   - Staff lists users, sees a row per seeded customer.
 *   - Staff toggles can_reserve_orders → backend reflects it; toggle
 *     state survives a reload.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedShopStaff,
  type SeededCustomer,
} from './helpers/backend'

async function loginAs(page: Page, user: SeededCustomer): Promise<void> {
  const loginRes = await page.request.post(
    'http://localhost:8000/api/v1/auth/login/',
    { data: { email: user.email, password: user.password } },
  )
  const tokens = await loginRes.json()
  const access = tokens.access ?? tokens.access_token
  const refresh = tokens.refresh ?? tokens.refresh_token
  const meRes = await page.request.get('http://localhost:8000/api/v1/users/me/', {
    headers: { Authorization: `Bearer ${access}` },
  })
  const me = await meRes.json()
  await page.goto('/')
  await page.evaluate(
    ({ access, refresh, user }) => {
      localStorage.setItem('endos.access', access)
      localStorage.setItem('endos.refresh', refresh)
      localStorage.setItem('endos.user', JSON.stringify(user))
    },
    { access, refresh, user: me },
  )
}

test.describe('admin users screen', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('customer is redirected away from /admin/users', async ({ page }) => {
    const customer = seedActiveCustomer()
    await loginAs(page, customer)
    await page.goto('/admin/users')
    // Router guard sends them to /home (root). Either way, they should
    // NOT be on /admin/users.
    await expect(page).not.toHaveURL(/\/admin\/users$/, { timeout: 5_000 })
  })

  test('staff sees the users table with seeded rows', async ({ page }) => {
    const target = seedActiveCustomer({
      email: 'reserva-target@example.com',
      first_name: 'Reserva',
      last_name: 'Target',
    })
    const staff = seedShopStaff()
    await loginAs(page, staff)

    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('admin-users-list')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText(target.email)).toBeVisible()
  })

  test('staff toggles can_reserve_orders + the change survives reload', async ({
    page,
  }) => {
    const target = seedActiveCustomer({
      email: 'reserva-toggle@example.com',
      first_name: 'Reserva',
      last_name: 'Toggle',
      can_reserve_orders: false,
    })
    const staff = seedShopStaff()
    await loginAs(page, staff)

    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' })

    // Find the row's toggle via the user's uuid — we don't have it
    // from the seed helper, so find by email text and walk to its
    // checkbox.
    const row = page.locator('tr', { hasText: target.email })
    const toggle = row.locator('input[type="checkbox"]')
    await expect(toggle).not.toBeChecked()

    await toggle.check()
    // Backend should now reflect can_reserve_orders=true. Reload to
    // verify it's not just a local optimistic flip.
    await page.reload()
    const rowAfter = page.locator('tr', { hasText: target.email })
    const toggleAfter = rowAfter.locator('input[type="checkbox"]')
    await expect(toggleAfter).toBeChecked()
  })
})
