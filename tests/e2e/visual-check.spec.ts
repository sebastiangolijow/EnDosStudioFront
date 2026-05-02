/**
 * Visual sanity-check spec — screenshots every view I've built so far,
 * so the agent (or a human reviewer) can compare them to docs/mockups.jpeg.
 *
 * Not a regression test. Run on demand with:
 *   npm run e2e -- tests/e2e/visual-check.spec.ts
 *
 * Outputs full-page PNGs to test-results/visual-check/.
 */
import { test } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  seedOrdersForCustomer,
} from './helpers/backend'

test.describe.configure({ mode: 'serial' })

test.describe('visual check', () => {
  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('home page', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: 'test-results/visual-check/01-home.png', fullPage: true })
  })

  test('login page', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: 'test-results/visual-check/02-login.png', fullPage: true })
  })

  test('register page', async ({ page }) => {
    await page.goto('/register')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: 'test-results/visual-check/03-register.png', fullPage: true })
  })

  test('forgot password', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: 'test-results/visual-check/04-forgot-password.png',
      fullPage: true,
    })
  })

  test('reset password (with fake params)', async ({ page }) => {
    await page.goto('/reset-password?uid=fake&token=fake')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: 'test-results/visual-check/05-reset-password.png',
      fullPage: true,
    })
  })

  test('set password (with fake params)', async ({ page }) => {
    await page.goto('/set-password?email=test%40example.com&token=fake')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: 'test-results/visual-check/06-set-password.png',
      fullPage: true,
    })
  })

  test('dashboard — empty state', async ({ page }) => {
    const customer = seedActiveCustomer()

    // Programmatic login
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

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: 'test-results/visual-check/07-dashboard-empty.png',
      fullPage: true,
    })
  })

  test('dashboard — with orders', async ({ page }) => {
    const customer = seedActiveCustomer()
    seedOrdersForCustomer(customer, ['placed', 'paid', 'in_production', 'shipped', 'delivered'])

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

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: 'test-results/visual-check/08-dashboard-with-orders.png',
      fullPage: true,
    })
  })
})
