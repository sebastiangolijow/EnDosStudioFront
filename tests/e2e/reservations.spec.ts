/**
 * Reservation flow — whitelisted customers reserve for in-store pickup
 * instead of paying through Stripe.
 *
 * Coverage:
 *   - Non-whitelisted customer does NOT see the Reserve CTA.
 *   - Whitelisted customer sees it.
 *   - Whitelisted customer fills the modal + reserves → lands on
 *     confirmation page with the pickup block.
 *   - Past pickup datetime is rejected client-side with a toast.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedOrderForCustomer,
  type SeededCustomer,
} from './helpers/backend'

async function loginAs(page: Page, user: SeededCustomer): Promise<string> {
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
  return access
}

test.describe('reservations', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('non-whitelisted customer does NOT see the Reserve CTA', async ({
    page,
  }) => {
    const customer = seedActiveCustomer({ can_reserve_orders: false })
    const uuid = seedOrderForCustomer(customer, {
      status: 'draft',
      with_original_file: true,
    })
    await loginAs(page, customer)

    await page.goto(`/checkout/${uuid}`)
    await expect(page.getByTestId('checkout-pay')).toBeVisible()
    await expect(page.getByTestId('checkout-reserve')).toHaveCount(0)
  })

  test('whitelisted customer sees the Reserve CTA', async ({ page }) => {
    const customer = seedActiveCustomer({ can_reserve_orders: true })
    const uuid = seedOrderForCustomer(customer, {
      status: 'draft',
      with_original_file: true,
    })
    await loginAs(page, customer)

    await page.goto(`/checkout/${uuid}`)
    await expect(page.getByTestId('checkout-reserve')).toBeVisible()
  })

  test('reserve flow: fill modal → order status flips to reserved → confirmation page shows pickup block', async ({
    page,
  }) => {
    const customer = seedActiveCustomer({ can_reserve_orders: true })
    const uuid = seedOrderForCustomer(customer, {
      status: 'draft',
      with_original_file: true,
    })
    await loginAs(page, customer)

    await page.goto(`/checkout/${uuid}`)

    // Open the modal.
    await page.getByTestId('checkout-reserve').click()
    const dateInput = page.getByTestId('reserve-pickup-date')
    const timeInput = page.getByTestId('reserve-pickup-time')
    await expect(dateInput).toBeVisible()
    await expect(timeInput).toBeVisible()

    // Pick a future date (today + 5 days).
    const future = new Date()
    future.setDate(future.getDate() + 5)
    const iso = future.toISOString().slice(0, 10)
    await dateInput.fill(iso)
    await timeInput.fill('11:30')

    // Submit. Backend transitions to 'reserved' and the frontend
    // routes to /confirmation.
    await page.getByTestId('reserve-submit').click()
    await expect(page).toHaveURL(new RegExp(`/confirmation/${uuid}$`), {
      timeout: 10_000,
    })

    // Confirmation page renders the reserved-specific block + heading.
    await expect(page.getByText('Pedido reservado')).toBeVisible()
    await expect(page.getByTestId('confirmation-pickup-block')).toBeVisible()
  })

  test('past datetime is rejected with a toast', async ({ page }) => {
    const customer = seedActiveCustomer({ can_reserve_orders: true })
    const uuid = seedOrderForCustomer(customer, {
      status: 'draft',
      with_original_file: true,
    })
    await loginAs(page, customer)

    await page.goto(`/checkout/${uuid}`)
    await page.getByTestId('checkout-reserve').click()

    // Yesterday — clearly in the past.
    const past = new Date()
    past.setDate(past.getDate() - 1)
    await page.getByTestId('reserve-pickup-date').fill(past.toISOString().slice(0, 10))
    await page.getByTestId('reserve-pickup-time').fill('10:00')
    await page.getByTestId('reserve-submit').click()

    // The submit shouldn't transition the order. Stay on /checkout.
    await expect(page).toHaveURL(new RegExp(`/checkout/${uuid}$`))
  })
})
