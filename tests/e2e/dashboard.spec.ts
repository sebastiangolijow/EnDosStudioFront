/**
 * Dashboard spec — does the customer's order history actually load?
 *
 * Coverage:
 *   - Customer with orders: dashboard fetches /api/v1/orders/, renders a card
 *     per order, status badges show the right color/label, filter pills work.
 *   - Customer with no orders: empty state with "Crear mi primer pedido" CTA.
 *   - Filter logic: clicking "Entregado" hides everything else.
 *
 * REQUIRES the Django backend running (`make up` in the backend repo).
 *
 * Test isolation: each test seeds its own customer with a unique email so
 * concurrent runs don't collide. `afterAll` cleans up.
 */
import { test, expect, Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedDraftForCustomer,
  seedOrdersForCustomer,
  SeededCustomer,
} from './helpers/backend'

/**
 * Log in programmatically — POST /auth/login/ + GET /users/me/, then seed
 * tokens + user into localStorage and navigate to /dashboard. Skips the UI
 * login flow entirely.
 *
 * Why: this spec is about the dashboard, not the login form. Login UX has its
 * own coverage in auth-pages.spec.ts. Programmatic login is faster, more
 * reliable, and keeps each test focused on what it's actually testing.
 */
async function loginAs(page: Page, customer: SeededCustomer): Promise<void> {
  const loginRes = await page.request.post('http://localhost:8000/api/v1/auth/login/', {
    data: { email: customer.email, password: customer.password },
  })
  if (!loginRes.ok()) {
    throw new Error(`login API failed: ${loginRes.status()} ${await loginRes.text()}`)
  }
  const tokens = await loginRes.json()
  const access = tokens.access ?? tokens.access_token
  const refresh = tokens.refresh ?? tokens.refresh_token

  const meRes = await page.request.get('http://localhost:8000/api/v1/users/me/', {
    headers: { Authorization: `Bearer ${access}` },
  })
  if (!meRes.ok()) {
    throw new Error(`/users/me/ failed: ${meRes.status()}`)
  }
  const user = await meRes.json()

  // Inject session into localStorage BEFORE navigating, so the auth.store
  // reads it on init.
  await page.goto('/')
  await page.evaluate(
    ({ access, refresh, user }) => {
      localStorage.setItem('endos.access', access)
      localStorage.setItem('endos.refresh', refresh)
      localStorage.setItem('endos.user', JSON.stringify(user))
    },
    { access, refresh, user },
  )

  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 5_000 })
}

test.describe('dashboard', () => {
  // Run tests in this file serially. Each test seeds its own customer with a
  // unique email (no collision risk) but the docker-compose-exec calls and the
  // dev server's reactive state get racy under parallelism. Serial keeps the
  // logs readable and the suite reliable.
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })

  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('empty state: customer with no orders sees "Crear mi primer pedido" CTA', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    await loginAs(page, customer)

    await expect(page.getByTestId('dashboard-empty')).toBeVisible()
    await expect(page.getByText('Aún no tenés pedidos.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Crear mi primer pedido' })).toBeVisible()
  })

  test('order list: customer with seeded orders sees a card per order', async ({ page }) => {
    const customer = seedActiveCustomer()
    const seeded = seedOrdersForCustomer(customer, [
      'placed',
      'paid',
      'in_production',
      'shipped',
      'delivered',
    ])

    await loginAs(page, customer)

    // List should have 5 cards
    const cards = page.getByTestId('dashboard-orders').locator('li')
    await expect(cards).toHaveCount(5)

    // Each seeded order should be reachable by its UUID-keyed testid
    for (const order of seeded) {
      await expect(page.getByTestId(`order-card-${order.uuid}`)).toBeVisible()
    }

    // Each status badge appears at least once inside an order card. Using
    // the scoped locator avoids a strict-mode collision with the filter pills
    // which use the same Spanish labels.
    const ordersScope = page.getByTestId('dashboard-orders')
    for (const label of ['Realizado', 'Pagado', 'En producción', 'Enviado', 'Entregado']) {
      await expect(ordersScope.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test('filter pills: clicking "Entregado" narrows the list to delivered orders', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    seedOrdersForCustomer(customer, ['placed', 'delivered', 'delivered', 'cancelled'])

    await loginAs(page, customer)

    // Default "Todos" shows all 4
    await expect(page.getByTestId('dashboard-orders').locator('li')).toHaveCount(4)

    // Click "Entregado"
    await page.getByTestId('filter-delivered').click()
    await expect(page.getByTestId('dashboard-orders').locator('li')).toHaveCount(2)

    // Click "Cancelado"
    await page.getByTestId('filter-cancelled').click()
    await expect(page.getByTestId('dashboard-orders').locator('li')).toHaveCount(1)

    // Click "Todos" — back to 4
    await page.getByTestId('filter-all').click()
    await expect(page.getByTestId('dashboard-orders').locator('li')).toHaveCount(4)
  })

  test('drafts are NOT shown in the dashboard', async ({ page }) => {
    // Customer has one placed order + one draft. Drafts must be hidden from
    // the dashboard (they're mid-edit, not committed orders).
    const customer = seedActiveCustomer()
    seedOrdersForCustomer(customer, ['placed'])
    seedDraftForCustomer(customer)

    await loginAs(page, customer)

    // Only the placed order shows. Scope the badge match inside the orders
    // list to avoid colliding with the filter pill that has the same label.
    const ordersScope = page.getByTestId('dashboard-orders')
    await expect(ordersScope.locator('li')).toHaveCount(1)
    await expect(ordersScope.getByText('Realizado', { exact: true })).toBeVisible()
  })
})
