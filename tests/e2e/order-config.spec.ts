/**
 * Order config spec — does step 3 (material/size/quantity) actually wire to
 * the backend's PATCH /orders/{uuid}/ + GET /orders/quote/?
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

/** Upload a file to a draft via the backend's REST endpoint, so the order
 *  has an `original` file that the summary thumbnail can render. */
async function uploadOriginal(
  page: Page,
  accessToken: string,
  orderUuid: string,
): Promise<void> {
  const fs = await import('node:fs')
  const buffer = fs.readFileSync(FIXTURE)
  const res = await page.request.post(
    `http://localhost:8000/api/v1/orders/${orderUuid}/files/`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      multipart: {
        kind: 'original',
        file: { name: 'sample.png', mimeType: 'image/png', buffer },
      },
    },
  )
  if (!res.ok()) {
    throw new Error(`upload failed: ${res.status()} ${await res.text()}`)
  }
}

test.describe('order config', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('full flow: pick material → size → quantity → see total → continue', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Stepper: step 3 active
    await expect(page.getByText('Material y tamaño')).toBeVisible()

    // Pick a material
    await page.getByTestId('material-holografico').click()
    await expect(page.getByTestId('material-holografico')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Pick a size (5 cm)
    await page.getByTestId('size-50').click()

    // Bump quantity from default 100 down to 50 (10 clicks at step=5)
    for (let i = 0; i < 10; i++) {
      await page.getByTestId('quantity-decrease').click()
    }
    await expect(page.getByTestId('quantity-input')).toHaveValue('50')

    // Wait for the debounced quote to land. The gold-standard backend formula
    // for holografico 5×5cm q=50 with no add-ons is 110 EUR.
    await expect(page.getByTestId('summary-total')).toHaveText(/110\.00/, { timeout: 5_000 })

    // Click Continuar al pago — should PATCH the order then route to /checkout/{uuid}
    await page.getByTestId('summary-continue').click()
    await expect(page).toHaveURL(new RegExp(`/checkout/${draftUuid}$`), { timeout: 10_000 })

    // Verify the backend now has the order patched
    const orderRes = await page.request.get(
      `http://localhost:8000/api/v1/orders/${draftUuid}/`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const order = await orderRes.json()
    expect(order.material).toBe('holografico')
    expect(order.width_mm).toBe(50)
    expect(order.height_mm).toBe(50)
    expect(order.quantity).toBe(50)
  })

  test('add-ons: toggling barniz updates the total', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Pick vinilo_blanco at 5×5 cm × 50 = 105 EUR (gold-standard for white vinyl)
    await page.getByTestId('material-vinilo_blanco').click()
    await page.getByTestId('size-50').click()
    for (let i = 0; i < 10; i++) {
      await page.getByTestId('quantity-decrease').click()
    }
    await expect(page.getByTestId('summary-total')).toHaveText(/105\.00/, { timeout: 5_000 })

    // Toggle Barniz: 105 + 8 = 113
    await page.getByTestId('addon-varnish').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/113\.00/, { timeout: 5_000 })

    // Toggle Relieve: 113 + 12 = 125
    await page.getByTestId('addon-relief').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/125\.00/, { timeout: 5_000 })

    // Untoggle Barniz: 125 - 8 = 117
    await page.getByTestId('addon-varnish').uncheck()
    await expect(page.getByTestId('summary-total')).toHaveText(/117\.00/, { timeout: 5_000 })
  })

  test('continue is disabled until material is picked', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // No material picked yet → CTA disabled, no total shown
    await expect(page.getByTestId('summary-continue')).toBeDisabled()

    // Pick one → CTA enables once the quote arrives
    await page.getByTestId('material-vinilo_blanco').click()
    await expect(page.getByTestId('summary-continue')).toBeEnabled({ timeout: 5_000 })
  })

  test('shape: contorneado is the default and shows the Refinar contorno CTA', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Default shape is contorneado — its card carries the selected style.
    await expect(page.getByTestId('shape-contorneado')).toHaveAttribute('aria-pressed', 'true')
    // Refine-contour bar visible (only relevant for contorneado).
    await expect(page.getByTestId('refine-contour-bar')).toBeVisible()
  })

  test('shape: picking a geometric shape hides the Refinar contorno CTA', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    await page.getByTestId('shape-circulo').click()
    await expect(page.getByTestId('shape-circulo')).toHaveAttribute('aria-pressed', 'true')
    // Refining the contour doesn't make sense for a circle — the CTA hides.
    await expect(page.getByTestId('refine-contour-bar')).toBeHidden()
  })

  test('shape: choice persists to the backend on Continuar', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Pick a non-default shape, plus the minimum needed to enable Continuar.
    await page.getByTestId('shape-redondeadas').click()
    await page.getByTestId('material-vinilo_blanco').click()
    await expect(page.getByTestId('summary-continue')).toBeEnabled({ timeout: 5_000 })
    await page.getByTestId('summary-continue').click()

    // Lands on /checkout — the backend now has shape=redondeadas.
    await expect(page).toHaveURL(new RegExp(`/checkout/${draftUuid}$`), { timeout: 10_000 })
    const orderRes = await page.request.get(
      `http://localhost:8000/api/v1/orders/${draftUuid}/`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const order = await orderRes.json()
    expect(order.shape).toBe('redondeadas')
  })
})
