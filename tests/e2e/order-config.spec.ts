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

    // Pick a material — holografico is small enough at 5×5 q=50 to hit
    // the 20€ floor under the new (2026-05-09) formula. Useful here as a
    // visible signal that the floor logic is wired end-to-end.
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

    // ((50+15)/1000)² × 50 × 50€ = 10.5625€ → floored to 20.00€
    await expect(page.getByTestId('summary-total')).toHaveText(/20\.00/, { timeout: 5_000 })

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

  test('add-ons: toggling relieve and barniz updates the total', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Pick a setup that sits comfortably above the 20€ floor so the
    // additive percent surcharges actually move the displayed total.
    // vinilo_blanco 10×10cm q=100 → 5951.25 cents ≈ 59.51€ subtotal.
    await page.getByTestId('material-vinilo_blanco').click()
    await page.getByTestId('size-100').click()
    // quantity defaults to 100 — no clicks needed
    await expect(page.getByTestId('summary-total')).toHaveText(/59\.51/, { timeout: 5_000 })

    // Barniz brillo (+20%): 59.5125 × 1.20 = 71.415 → 71.42€
    await page.getByTestId('varnish-brillo').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/71\.42/, { timeout: 5_000 })

    // Relieve (+35%): additive multiplier becomes 1.55 → 92.24€
    await page.getByTestId('addon-relief').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/92\.24/, { timeout: 5_000 })

    // Switch barniz brillo → opaco: same +20%, total unchanged at 92.24€
    await page.getByTestId('varnish-opaco').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/92\.24/, { timeout: 5_000 })

    // Switch barniz off (radio "none"): drops back to relieve only → 80.34€
    // (5951.25 × 1.35 = 8034.1875 → 8034 cents)
    await page.getByTestId('varnish-none').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/80\.34/, { timeout: 5_000 })
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

  test('shape: contorneado is the default and the editor CTA is always visible', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Default shape is contorneado — its card carries the selected style.
    await expect(page.getByTestId('shape-contorneado')).toHaveAttribute('aria-pressed', 'true')
    // Volver-al-editor bar always visible — every shape passes through the
    // editor for margin adjustment, not just contorneado.
    await expect(page.getByTestId('refine-contour-bar')).toBeVisible()
  })

  test('shape: picking a geometric shape keeps the editor CTA visible', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftForCustomer(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    await page.getByTestId('shape-circulo').click()
    await expect(page.getByTestId('shape-circulo')).toHaveAttribute('aria-pressed', 'true')
    // Geometric shapes still go through the editor (for margin adjustment).
    await expect(page.getByTestId('refine-contour-bar')).toBeVisible()
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
