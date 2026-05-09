/**
 * Admin product create — staff fills the Vue form and the new product
 * shows up in /admin/products + /catalogo (public).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedShopStaff,
  type SeededCustomer,
} from './helpers/backend'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(__dirname, 'fixtures/sample-design.png')

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

test.describe('catalog admin create', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('staff creates a product → appears in admin list and public catalog', async ({ page }) => {
    const staff = seedShopStaff()
    await loginAs(page, staff)

    await page.goto('/admin/products')

    // Click "+ Nuevo producto"
    await page.getByTestId('admin-products-new').click()
    await expect(page).toHaveURL('/admin/products/new')

    // Fill the form
    const uniqueName = `Llavero E2E ${Date.now().toString(36)}`
    await page.getByTestId('admin-product-name').fill(uniqueName)
    await page.getByTestId('admin-product-description').fill('Descripcion E2E')
    await page.getByTestId('admin-product-price-eur').fill('25')
    await page.getByTestId('admin-product-stock').fill('7')
    await page.getByTestId('admin-product-image').setInputFiles(FIXTURE)

    // Submit
    await page.getByTestId('admin-product-submit').click()

    // Lands back on /admin/products with the new row visible
    await expect(page).toHaveURL('/admin/products', { timeout: 10_000 })
    await expect(page.getByText(uniqueName).first()).toBeVisible()

    // Verify it's also in the public catalog
    await page.goto('/catalogo')
    await expect(page.getByText(uniqueName).first()).toBeVisible()
  })

  test('non-staff cannot reach /admin/products (router guard)', async ({ page }) => {
    // Anon visit — guard should redirect to /login
    await page.goto('/admin/products')
    await expect(page).toHaveURL(/\/login/)
  })
})
