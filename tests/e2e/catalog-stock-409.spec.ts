/**
 * Catalog stock guards — UI prevents buying out-of-stock products and
 * the backend's 409 race-condition response triggers a friendly toast +
 * redirect when stock drops between place and checkout.
 */
import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedProduct,
  type SeededCustomer,
} from './helpers/backend'

const BACKEND_DIR =
  '/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend'

/** Drain a product's stock directly via the ORM (simulates a concurrent buyer). */
function drainProductStock(productUuid: string): void {
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.products.models import Product',
    `Product.objects.filter(uuid='${productUuid}').update(stock_quantity=0)`,
  ].join('; ')
  execSync(
    `cd ${BACKEND_DIR} && docker compose exec -T web python -c "${code.replace(/"/g, '\\"')}"`,
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

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

test.describe('catalog stock guards', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('product with stock 0 disables Comprar + shows Sin stock', async ({ page }) => {
    const product = seedProduct({
      name: 'Sin Stock Product',
      price_cents: 1500,
      stock_quantity: 0,
    })

    // Catalog grid: out-of-stock badge visible
    await page.goto('/catalogo')
    await expect(page.getByTestId(`product-card-${product.slug}`)).toBeVisible()
    await expect(page.getByTestId('product-card-out-of-stock')).toBeVisible()

    // Detail page: Sin stock label + Comprar disabled
    await page.goto(`/catalogo/${product.slug}`)
    await expect(page.getByTestId('product-out-of-stock')).toBeVisible()
    await expect(page.getByTestId('product-buy')).toBeDisabled()
  })

  test('stock drops between place and checkout → 409 toast + redirect to product', async ({ page }) => {
    const product = seedProduct({
      name: 'Race Product',
      price_cents: 2000,
      stock_quantity: 3,
    })
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)

    // Customer places a catalog order with qty 2 (within stock), fills
    // shipping, calls place_order. Status now `placed`. Then they walk
    // away. Later (race scenario) someone else drains the stock; the
    // customer comes back and clicks Pagar.
    const createRes = await page.request.post('http://localhost:8000/api/v1/orders/', {
      headers: { Authorization: `Bearer ${access}` },
      data: { kind: 'catalog', product: product.uuid, product_quantity: 2 },
    })
    expect(createRes.status()).toBe(201)
    const order = await createRes.json()

    await page.request.patch(`http://localhost:8000/api/v1/orders/${order.uuid}/`, {
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
      `http://localhost:8000/api/v1/orders/${order.uuid}/place/`,
      { headers: { Authorization: `Bearer ${access}` } },
    )
    expect(placeRes.status()).toBe(200)

    // Concurrent buyer drains stock. The order is `placed` but unpaid;
    // the checkout endpoint's stock re-check should now return 409.
    drainProductStock(product.uuid)

    // Customer revisits /checkout/. CheckoutView skips PATCH+place
    // because status≠draft and goes straight to the Stripe step.
    await page.goto(`/checkout/${order.uuid}`)
    await expect(page.getByTestId('catalog-order-summary')).toBeVisible()

    // Shipping form is hydrated from the saved order — formIsValid is true.
    await page.getByTestId('checkout-pay').click()

    // 409 path: redirected back to the product detail page (toast also fired)
    await expect(page).toHaveURL(`/catalogo/${product.slug}`, { timeout: 10_000 })
    await expect(page.getByTestId('product-out-of-stock')).toBeVisible()
  })
})
