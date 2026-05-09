/**
 * Catalog buy flow — login → product detail → Comprar → CheckoutView →
 * shipping form → place_order → catalog summary → dashboard renders
 * the catalog order card.
 *
 * Stripe is intentionally NOT live in dev (keys are placeholders),
 * so /checkout/ returns 502 and the friendly error renders. We
 * assert the shipping PATCH + place_order transition + catalog
 * summary rendering — same shape as the existing sticker
 * checkout.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedProduct,
  type SeededCustomer,
} from './helpers/backend'

async function loginAs(page: Page, customer: SeededCustomer): Promise<string> {
  const loginRes = await page.request.post('http://localhost:8000/api/v1/auth/login/', {
    data: { email: customer.email, password: customer.password },
  })
  const tokens = await loginRes.json()
  const access = tokens.access ?? tokens.access_token
  const refresh = tokens.refresh ?? tokens.refresh_token
  const meRes = await page.request.get('http://localhost:8000/api/v1/users/me/', {
    headers: { Authorization: `Bearer ${access}` },
  })
  const user = await meRes.json()
  await page.goto('/')
  await page.evaluate(
    ({ access, refresh, user }) => {
      localStorage.setItem('endos.access', access)
      localStorage.setItem('endos.refresh', refresh)
      localStorage.setItem('endos.user', JSON.stringify(user))
    },
    { access, refresh, user },
  )
  return access
}

test.describe('catalog buy flow', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('login → product → Comprar → checkout shows catalog summary + Stripe 502 error', async ({ page }) => {
    const product = seedProduct({
      name: 'Llavero Buy Flow',
      description: 'Acrilico transparente',
      price_cents: 1500, // 15.00 €
      stock_quantity: 20,
    })
    const customer = seedActiveCustomer()
    await loginAs(page, customer)

    // Land on the product detail page
    await page.goto(`/catalogo/${product.slug}`)
    await expect(page.getByTestId('product-detail')).toBeVisible()

    // Bump qty to 2 (15 × 2 = 30 €)
    await page.getByTestId('qty-increase').click()
    await expect(page.getByTestId('qty-value')).toHaveText('2')
    await expect(page.getByTestId('product-total')).toHaveText('€30.00')

    // Comprar → creates a catalog order, routes to /checkout/{uuid}
    await page.getByTestId('product-buy').click()
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/, { timeout: 10_000 })

    // Right-rail summary uses the catalog component, not the sticker one
    await expect(page.getByTestId('catalog-order-summary')).toBeVisible()
    await expect(page.getByTestId('catalog-summary-total')).toContainText('30.00')
    await expect(page.getByText('Llavero Buy Flow')).toBeVisible()

    // Fill shipping
    await page.getByLabel('Nombre del destinatario').fill('Test Buyer')
    await page.getByLabel('Dirección').fill('Carrer Test 1')
    await page.getByLabel('Ciudad').fill('Barcelona')
    await page.getByLabel('Código postal').fill('08001')
    // country defaults to ES

    // Pay → backend returns 502 (no Stripe keys in dev). The shipping PATCH +
    // place_order still ran; the friendly error renders.
    await page.getByTestId('checkout-pay').click()
    await expect(page.getByTestId('checkout-error')).toContainText(
      'procesador de pagos',
      { timeout: 10_000 },
    )

    // The order is now `placed` — verify directly via API
    const orderUuid = page.url().split('/').pop()!
    const orderRes = await page.request.get(
      `http://localhost:8000/api/v1/orders/${orderUuid}/`,
      {
        headers: {
          Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('endos.access'))}`,
        },
      },
    )
    const order = await orderRes.json()
    expect(order.kind).toBe('catalog')
    expect(order.status).toBe('placed')
    expect(order.product_quantity).toBe(2)
    expect(order.total_amount_cents).toBe(3000) // 1500 × 2
    expect(order.recipient_name).toBe('Test Buyer')
  })

  test('dashboard renders catalog order card with product name + qty', async ({ page }) => {
    const product = seedProduct({
      name: 'Llavero Dashboard',
      price_cents: 2000,
      stock_quantity: 5,
    })
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)

    // Create a catalog order via the API (faster than walking the UI)
    const createRes = await page.request.post('http://localhost:8000/api/v1/orders/', {
      headers: { Authorization: `Bearer ${access}` },
      data: { kind: 'catalog', product: product.uuid, product_quantity: 1 },
    })
    expect(createRes.status()).toBe(201)
    const created = await createRes.json()

    // PATCH shipping + place
    await page.request.patch(`http://localhost:8000/api/v1/orders/${created.uuid}/`, {
      headers: { Authorization: `Bearer ${access}` },
      data: {
        recipient_name: 'Test',
        street_line_1: 'C/ Test 1',
        city: 'Barcelona',
        postal_code: '08001',
        country: 'ES',
      },
    })
    const placeRes = await page.request.post(
      `http://localhost:8000/api/v1/orders/${created.uuid}/place/`,
      { headers: { Authorization: `Bearer ${access}` } },
    )
    expect(placeRes.status()).toBe(200)

    // Visit the dashboard — the order card uses the catalog product line
    await page.goto('/dashboard')
    const card = page.getByTestId(`order-card-${created.uuid}`)
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('Llavero Dashboard')
    await expect(card).toContainText('1 unidad(es)')
    await expect(card).toContainText('€20.00')
  })
})
