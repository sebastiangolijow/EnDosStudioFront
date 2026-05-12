/**
 * Order config spec — simplified after 2026-05-12 demo feedback.
 *
 * Material + shape were moved entirely to the editor (step 1). This
 * screen now handles only size, quantity, acabado, and tinta blanca.
 * Acabado is a single mutually-exclusive radio group across relieve /
 * barniz brillo / barniz opaco; tinta blanca is independent.
 *
 * The tests seed orders with material + shape ALREADY set (the editor
 * would have done that). We then exercise what this page still owns.
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
  seedOrderForCustomer,
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

/** Attach an original file to a draft via the backend so the summary
 *  thumbnail can render. seedOrderForCustomer creates an order with
 *  material/dimensions/quantity already set; this adds the file. */
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

/** Seed a draft order with material+dimensions matching the editor
 *  having already set them, but in draft status so order-config can
 *  load it. seedOrderForCustomer defaults to status='placed' which
 *  would redirect to checkout; pass status='draft' instead. */
function seedDraftWithMaterial(customer: SeededCustomer): string {
  return seedOrderForCustomer(customer, { status: 'draft' })
}

test.describe('order config', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('size + quantity changes update the total; Continuar lands on /checkout', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftWithMaterial(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Stepper: step 2 active (Material y tamaño). Two labels render
    // (desktop + mobile via responsive show/hide); .first() picks one.
    await expect(page.getByText('Material y tamaño').first()).toBeVisible()

    // Seeded order: vinilo_blanco 10×10 cm q=100 → 5951 pre-IVA cents
    // → ×1.21 = 7201 cents all-in (≈ 72.01€).
    await expect(page.getByTestId('summary-total')).toHaveText(/72\.01/, {
      timeout: 5_000,
    })

    // Continuar → /checkout/{uuid}
    await page.getByTestId('summary-continue').click()
    await expect(page).toHaveURL(new RegExp(`/checkout/${draftUuid}$`), {
      timeout: 10_000,
    })
  })

  test('acabado radio: relieve, brillo, opaco are mutually exclusive', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftWithMaterial(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Seeded order at vinilo_blanco 10×10 q=100 → 72.01€ all-in (5951
    // pre-IVA × 1.21).
    await expect(page.getByTestId('summary-total')).toHaveText(/72\.01/, {
      timeout: 5_000,
    })

    // Pick barniz brillo (+20%): pre-IVA 5951 × 1.20 = 7142;
    // ×1.21 = 8642 → 86.42€.
    await page.getByTestId('acabado-brillo').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/86\.42/, {
      timeout: 5_000,
    })

    // Pick relieve (+35%): radio replaces brillo. Pre-IVA 5951 × 1.35 =
    // 8034; ×1.21 = 9721 → 97.21€.
    await page.getByTestId('acabado-relieve').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/97\.21/, {
      timeout: 5_000,
    })

    // Relief-note textarea appears when relieve is active.
    await expect(page.getByTestId('relief-note')).toBeVisible()

    // Switch back to "Sin acabado" → drops to baseline.
    await page.getByTestId('acabado-none').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/72\.01/, {
      timeout: 5_000,
    })
    // Relief-note input is hidden again.
    await expect(page.getByTestId('relief-note')).toHaveCount(0)
  })

  test('tinta blanca is independent — adds 35% on top of any acabado', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftWithMaterial(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    // Wait for the initial quote to land so the baseline 72.01 is in
    // place before we toggle add-ons. Avoids a race where clicking
    // tinta-blanca before the first quote arrives leaves the summary
    // showing '—' indefinitely (the debounce coalesces both requests).
    await expect(page.getByTestId('summary-total')).toHaveText(/72\.01/, {
      timeout: 10_000,
    })

    // Pick tinta blanca alone (+35%): pre-IVA 5951 × 1.35 = 8034;
    // ×1.21 = 9721 → 97.21€.
    await page.getByTestId('addon-tinta-blanca').click()
    await expect(page.getByTestId('summary-total')).toHaveText(/97\.21/, {
      timeout: 10_000,
    })

    // Add barniz brillo on top (+20%): combined multiplier 1.55.
    // Pre-IVA 5951 × 1.55 = 9224; ×1.21 = 11161 → 111.61€.
    await page.getByTestId('acabado-brillo').check()
    await expect(page.getByTestId('summary-total')).toHaveText(/111\.61/, {
      timeout: 10_000,
    })
  })

  test('acabado choice persists on PATCH at Continuar', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)
    const draftUuid = seedDraftWithMaterial(customer)
    await uploadOriginal(page, accessToken, draftUuid)

    await page.goto(`/order-config/${draftUuid}`)

    await page.getByTestId('acabado-opaco').click()
    await expect(page.getByTestId('summary-continue')).toBeEnabled({
      timeout: 5_000,
    })
    await page.getByTestId('summary-continue').click()
    await expect(page).toHaveURL(new RegExp(`/checkout/${draftUuid}$`), {
      timeout: 10_000,
    })

    // Backend reflects with_barniz_opaco=true, others false.
    const orderRes = await page.request.get(
      `http://localhost:8000/api/v1/orders/${draftUuid}/`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const order = await orderRes.json()
    expect(order.with_barniz_opaco).toBe(true)
    expect(order.with_barniz_brillo).toBe(false)
    expect(order.with_relief).toBe(false)
  })
})
