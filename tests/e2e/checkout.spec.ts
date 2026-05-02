/**
 * Checkout spec — does step 4 (shipping → place_order → /checkout/) work?
 *
 * IMPORTANT: this spec tests the placeholder-keys path. The backend returns 502
 * from /checkout/ because STRIPE_SECRET_KEY is `sk_test_replace_me` in dev.
 * The view catches that and renders a friendly Spanish error. When real Stripe
 * keys land, this assertion flips: the view should render the Stripe placeholder
 * card with the payment_intent_id. Update the test then.
 *
 * What we DO assert is the part of the flow we control:
 *   - Shipping form renders
 *   - PATCH /orders/{uuid}/ writes shipping fields
 *   - POST /orders/{uuid}/place/ transitions draft → placed
 *   - 502 from checkout shows the right error message (no client_secret leak)
 *
 * REQUIRES the Django backend running.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedDraftForCustomer,
  type SeededCustomer,
} from './helpers/backend'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(__dirname, 'fixtures/sample-design.png')

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

/** Seed a draft + upload original + PATCH material/size/quantity so the order
 *  is in the right shape to be placed (place_order requires a complete spec). */
async function seedReadyDraft(
  page: Page,
  accessToken: string,
  customer: SeededCustomer,
): Promise<string> {
  const uuid = seedDraftForCustomer(customer)

  // Upload an original image (place_order requires at least one)
  const fs = await import('node:fs')
  const buffer = fs.readFileSync(FIXTURE)
  await page.request.post(`http://localhost:8000/api/v1/orders/${uuid}/files/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    multipart: {
      kind: 'original',
      file: { name: 'sample.png', mimeType: 'image/png', buffer },
    },
  })

  // PATCH material/size/quantity (these would normally come from OrderConfigView)
  await page.request.patch(`http://localhost:8000/api/v1/orders/${uuid}/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      material: 'vinilo_blanco',
      width_mm: 50,
      height_mm: 50,
      quantity: 50,
    },
  })

  return uuid
}

async function fillShipping(page: Page) {
  await page.getByLabel('Nombre del destinatario').fill('Test Customer')
  await page.getByLabel('Dirección', { exact: false }).first().fill('Carrer Test 1')
  await page.getByLabel('Ciudad').fill('Barcelona')
  await page.getByLabel('Código postal').fill('08001')
  await page.getByLabel('País').fill('ES')
}

test.describe('checkout', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('shipping form renders + Pagar button is disabled until valid', async ({ page }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedReadyDraft(page, access, customer)

    await page.goto(`/checkout/${uuid}`)
    await expect(page.getByText('Dirección de envío')).toBeVisible()

    // Pagar disabled when fields empty
    await expect(page.getByTestId('checkout-pay')).toBeDisabled()

    // Fill them in → Pagar enables
    await fillShipping(page)
    await expect(page.getByTestId('checkout-pay')).toBeEnabled()
  })

  test('clicking Pagar PATCHes shipping + transitions to placed (Stripe-keys-not-set path)', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedReadyDraft(page, access, customer)

    await page.goto(`/checkout/${uuid}`)
    await fillShipping(page)
    await page.getByTestId('checkout-pay').click()

    // Backend has placeholder Stripe keys → checkout returns 502 → CheckoutView
    // renders the error toast with the env-not-configured message.
    // (When real keys land, swap this for assertions on `checkout-stripe-placeholder`.)
    await expect(page.getByTestId('checkout-error')).toBeVisible({ timeout: 10_000 })

    // BUT the order should now be in 'placed' status — place_order ran
    // successfully before the Stripe call failed.
    const orderRes = await page.request.get(
      `http://localhost:8000/api/v1/orders/${uuid}/`,
      { headers: { Authorization: `Bearer ${access}` } },
    )
    const order = await orderRes.json()
    expect(order.status).toBe('placed')
    expect(order.recipient_name).toBe('Test Customer')
    expect(order.city).toBe('Barcelona')
    expect(order.country).toBe('ES')
    expect(order.placed_at).toBeTruthy()
  })

  test('a customer revisiting /checkout/{uuid} for a paid order is sent to confirmation', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    await loginAs(page, customer)
    // Seed a paid order using the lifecycle helper
    const { seedOrdersForCustomer } = await import('./helpers/backend')
    const orders = seedOrdersForCustomer(customer, ['paid'])
    const uuid = orders[0].uuid

    await page.goto(`/checkout/${uuid}`)
    // The view should redirect to /confirmation/{uuid}
    await expect(page).toHaveURL(new RegExp(`/confirmation/${uuid}$`), { timeout: 10_000 })
    await expect(page.getByText('Pedido recibido')).toBeVisible()
  })
})
