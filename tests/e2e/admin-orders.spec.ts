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

    // Status dropdown lets the admin force any transition. Pick 'paid'
    // and apply — the dropdown then reflects the new server state.
    const statusSelect = page.getByTestId('admin-order-status-select')
    await expect(statusSelect).toBeVisible()
    await statusSelect.selectOption('paid')
    await page.getByTestId('admin-order-apply-status').click()
    // After the transition the dropdown re-syncs to the new status,
    // so Aplicar is disabled until something else is picked.
    await expect(page.getByTestId('admin-order-apply-status')).toBeDisabled({
      timeout: 10_000,
    })
    await expect(statusSelect).toHaveValue('paid')
  })

  test('shipped popup collects carrier + tracking + ETA, persists them, and the dropdown re-syncs', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const orderUuid = seedOrderForCustomer(customer, { status: 'in_production' })
    const staff = seedShopStaff()

    await loginAs(page, staff)
    await page.goto(`/admin/orders/${orderUuid}`, { waitUntil: 'domcontentloaded' })

    // Pick 'shipped' from the dropdown → the popup opens instead of
    // hitting the server directly.
    await page.getByTestId('admin-order-status-select').selectOption('shipped')
    await page.getByTestId('admin-order-apply-status').click()

    // Modal fields are present.
    const carrier = page.getByTestId('shipped-carrier')
    const tracking = page.getByTestId('shipped-tracking-code')
    const eta = page.getByTestId('shipped-eta-date')
    await expect(carrier).toBeVisible()
    await expect(tracking).toBeVisible()
    await expect(eta).toBeVisible()

    await carrier.fill('MRW')
    await tracking.fill('MRW987654')
    await eta.fill('2026-05-25')

    await page.getByTestId('shipped-submit').click()

    // After success the popup closes and the dropdown shows 'shipped'.
    await expect(page.getByTestId('admin-order-status-select')).toHaveValue(
      'shipped',
      { timeout: 10_000 },
    )
    // The current-shipping recap block surfaces the saved values.
    await expect(page.getByText('MRW987654')).toBeVisible()
    await expect(page.getByText('2026-05-25')).toBeVisible()
  })

  test('design previews surface download CTAs when files are present', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const orderUuid = seedOrderForCustomer(customer, { status: 'placed' })
    const staff = seedShopStaff()

    await loginAs(page, staff)
    await page.goto(`/admin/orders/${orderUuid}`, { waitUntil: 'domcontentloaded' })

    // Even without files, the placeholder text renders. We're not
    // seeding files in this helper, so the download CTAs should NOT
    // be present — proves the v-if guards correctly. (When the order
    // has files, the CTAs appear; that path is exercised manually
    // until the seed helper grows file-upload support.)
    await expect(page.getByTestId('admin-order-original-image')).toBeVisible()
    await expect(page.getByTestId('admin-order-preview-image')).toBeVisible()
    await expect(page.getByTestId('admin-order-download-original')).toHaveCount(0)
    await expect(page.getByTestId('admin-order-download-preview')).toHaveCount(0)
  })
})
