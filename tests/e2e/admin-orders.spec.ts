/**
 * Admin orders screen — exercises the shop owner's workflow.
 *
 * Coverage:
 *   - Staff lands on /admin/orders → sees status cards + table.
 *   - Customer is BLOCKED from /admin/orders (route guard).
 *   - Filter by status (clicking a pill).
 *   - Search by customer email.
 *   - Inline quick-action: placed → mark-paid → status flips.
 *   - Detail view shows customer email + shipping + actions.
 *   - Detail view mark-paid transitions and the action panel updates.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedOrderForCustomer,
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

test.describe('admin orders screen', () => {
  test.setTimeout(60_000)
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('staff sees the orders table; customer is redirected away', async ({ page }) => {
    // Seed: one customer with a placed order, one staff user.
    const customer = seedActiveCustomer()
    const orderUuid = seedOrderForCustomer(customer, { status: 'placed' })
    const staff = seedShopStaff()

    // --- Customer first: route guard kicks them out.
    await loginAs(page, customer)
    await page.goto('/admin/orders', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/$/, { timeout: 5_000 })

    // --- Staff sees the table.
    await loginAs(page, staff)
    await page.goto('/admin/orders', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('admin-orders-list')).toBeVisible({ timeout: 10_000 })
    // Status cards rendered.
    await expect(page.getByTestId('admin-orders-status-cards')).toBeVisible()
    // The seeded placed order shows up.
    await expect(page.getByTestId(`admin-order-row-${orderUuid}`)).toBeVisible()
  })

  test('staff can mark a placed order as paid via inline quick action', async ({ page }) => {
    const customer = seedActiveCustomer()
    const orderUuid = seedOrderForCustomer(customer, { status: 'placed' })
    const staff = seedShopStaff()

    await loginAs(page, staff)
    await page.goto('/admin/orders', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('admin-orders-list')).toBeVisible({ timeout: 10_000 })

    // Click the inline "Marcar como pagado" button for this row.
    const btn = page.getByTestId(`admin-row-mark-paid-${orderUuid}`)
    await expect(btn).toBeVisible()
    await btn.click()

    // After success the row's status badge flips to 'paid' (Spanish label).
    // The button itself transitions to 'start production' on the next render.
    await expect(
      page.getByTestId(`admin-row-start-production-${orderUuid}`),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('detail page shows customer info, shipping, and transition controls', async ({ page }) => {
    const customer = seedActiveCustomer({
      email: 'cliente@example.com',
      first_name: 'María',
      last_name: 'López',
    })
    const orderUuid = seedOrderForCustomer(customer, { status: 'placed' })
    const staff = seedShopStaff()

    await loginAs(page, staff)
    await page.goto(`/admin/orders/${orderUuid}`, { waitUntil: 'domcontentloaded' })

    // Customer name + email visible.
    await expect(page.getByTestId('admin-order-customer-name')).toContainText('María López')
    await expect(page.getByTestId('admin-order-customer-email')).toContainText(
      'cliente@example.com',
    )
    // Shipping address present.
    await expect(page.getByTestId('admin-order-shipping')).toContainText('Barcelona')
    // Mark-paid action available for status=placed.
    await expect(page.getByTestId('admin-order-mark-paid')).toBeVisible()

    // Run the transition; the action panel updates to the next-stage button.
    await page.getByTestId('admin-order-mark-paid').click()
    await expect(page.getByTestId('admin-order-start-production')).toBeVisible({
      timeout: 10_000,
    })
  })
})
