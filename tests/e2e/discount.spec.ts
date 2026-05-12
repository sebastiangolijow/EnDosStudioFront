/**
 * Promo / discount code flow.
 *
 * Customer applies a code at checkout → backend validates + recomputes
 * the order total → OrderSummary picks up the new totals + renders a
 * "Descuento" line. Errors surface as toasts (unknown code, disabled).
 *
 * Admin CRUD has its own spec (admin-discounts.spec.ts) — this one
 * focuses on the customer-facing path.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedDiscount,
  seedOrderForCustomer,
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
  const meRes = await page.request.get(
    'http://localhost:8000/api/v1/users/me/',
    { headers: { Authorization: `Bearer ${access}` } },
  )
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

test.describe('discount code at checkout', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('valid code applies and shows the Descuento line', async ({ page }) => {
    const customer = seedActiveCustomer()
    const uuid = seedOrderForCustomer(customer, { status: 'draft' })
    seedDiscount({ code: 'WELCOME10', percent_off: 10 })
    await loginAs(page, customer)

    await page.goto(`/checkout/${uuid}`)
    const input = page.getByTestId('checkout-discount-input')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill('WELCOME10')
    await page.getByTestId('checkout-discount-apply').click()

    // Applied pill appears; input is hidden.
    await expect(page.getByTestId('checkout-discount-applied')).toBeVisible({
      timeout: 10_000,
    })
    // Summary card surfaces the new line.
    await expect(page.getByTestId('summary-discount')).toBeVisible()
    await expect(page.getByTestId('summary-discount')).toContainText('WELCOME10')
  })

  test('unknown code shows an error toast and the order is unchanged', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const uuid = seedOrderForCustomer(customer, { status: 'draft' })
    await loginAs(page, customer)

    await page.goto(`/checkout/${uuid}`)
    await page.getByTestId('checkout-discount-input').fill('NONEXISTENT')
    await page.getByTestId('checkout-discount-apply').click()

    // Toast surfaces the error. Discount applied pill does NOT show.
    await expect(page.getByText('Código no encontrado.')).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.getByTestId('checkout-discount-applied')).toHaveCount(0)
  })

  test('disabled code is rejected', async ({ page }) => {
    const customer = seedActiveCustomer()
    const uuid = seedOrderForCustomer(customer, { status: 'draft' })
    seedDiscount({ code: 'OFFSALE', percent_off: 20, is_enabled: false })
    await loginAs(page, customer)

    await page.goto(`/checkout/${uuid}`)
    await page.getByTestId('checkout-discount-input').fill('OFFSALE')
    await page.getByTestId('checkout-discount-apply').click()

    await expect(page.getByText('Ese código ya no está activo.')).toBeVisible({
      timeout: 5_000,
    })
  })
})
