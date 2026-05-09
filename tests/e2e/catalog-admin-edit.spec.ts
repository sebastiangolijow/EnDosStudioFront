/**
 * Admin product edit — staff updates price + stock; the change is
 * reflected publicly on the catalog.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedProduct,
  seedShopStaff,
  type SeededCustomer,
} from './helpers/backend'

async function loginAs(page: Page, customer: SeededCustomer): Promise<void> {
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
}

test.describe('catalog admin edit', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('staff edits price + stock → visible publicly', async ({ page }) => {
    const product = seedProduct({
      name: 'Llavero Edit',
      price_cents: 1500, // 15.00 €
      stock_quantity: 10,
    })
    const staff = seedShopStaff()
    await loginAs(page, staff)

    await page.goto('/admin/products')
    await page.getByTestId(`admin-product-edit-${product.slug}`).click()
    await expect(page).toHaveURL(`/admin/products/${product.slug}/edit`)
    // Form is pre-populated
    await expect(page.getByTestId('admin-product-price-eur')).toHaveValue('15.00')
    await expect(page.getByTestId('admin-product-stock')).toHaveValue('10')

    // Update price + stock
    await page.getByTestId('admin-product-price-eur').fill('30')
    await page.getByTestId('admin-product-stock').fill('3')
    await page.getByTestId('admin-product-submit').click()

    await expect(page).toHaveURL('/admin/products', { timeout: 10_000 })

    // Public catalog reflects the change
    await page.goto(`/catalogo/${product.slug}`)
    await expect(page.getByText('€30.00').first()).toBeVisible()
    await expect(page.getByTestId('product-stock')).toContainText('3')
  })

  test('staff toggles is_active off → product disappears from public catalog', async ({ page }) => {
    const product = seedProduct({
      name: 'Llavero Toggle',
      price_cents: 1000,
      stock_quantity: 5,
    })
    const staff = seedShopStaff()
    await loginAs(page, staff)

    await page.goto('/admin/products')

    // Toggle is_active
    await page.getByTestId(`admin-product-toggle-${product.slug}`).click()
    // The button label flips
    await expect(page.getByTestId(`admin-product-toggle-${product.slug}`)).toHaveText('Oculto')

    // Public catalog: hidden
    await page.goto('/catalogo')
    await expect(page.getByTestId(`product-card-${product.slug}`)).toHaveCount(0)
  })
})
