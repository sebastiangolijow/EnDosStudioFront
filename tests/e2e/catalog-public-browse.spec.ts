/**
 * Catalog public browse — anonymous visitors can list products and open
 * the detail page. The "Comprar" CTA on the detail page redirects to
 * /login when the visitor isn't authenticated.
 */
import { test, expect } from '@playwright/test'
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedProduct,
} from './helpers/backend'

test.describe('catalog public browse', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('catalog list shows seeded products', async ({ page }) => {
    const product = seedProduct({
      name: 'Llavero E2E Browse',
      description: 'Acrílico transparente',
      price_cents: 1500,
      stock_quantity: 10,
    })

    await page.goto('/catalogo')

    await expect(page.getByRole('heading', { level: 1, name: 'Catálogo' })).toBeVisible()
    await expect(page.getByTestId(`product-card-${product.slug}`)).toBeVisible()
    await expect(page.getByText('Llavero E2E Browse')).toBeVisible()
    await expect(page.getByText('€15.00').first()).toBeVisible()
  })

  test('inactive products are hidden from anon catalog', async ({ page }) => {
    const visible = seedProduct({
      name: 'Visible E2E',
      price_cents: 1500,
      stock_quantity: 5,
    })
    const hidden = seedProduct({
      name: 'Oculto E2E',
      price_cents: 1500,
      stock_quantity: 5,
      is_active: false,
    })

    await page.goto('/catalogo')

    await expect(page.getByTestId(`product-card-${visible.slug}`)).toBeVisible()
    await expect(page.getByTestId(`product-card-${hidden.slug}`)).toHaveCount(0)
  })

  test('detail page renders + anon Comprar redirects to login', async ({ page }) => {
    const product = seedProduct({
      name: 'Llavero Detalle',
      description: 'Multi linea descripcion',
      price_cents: 2000,
      stock_quantity: 5,
    })

    await page.goto(`/catalogo/${product.slug}`)

    await expect(page.getByTestId('product-detail')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Llavero Detalle' })).toBeVisible()
    // Unit price displays pre-IVA (€20.00); Total includes IVA: 2000 ×
    // 1.21 = 2420 → €24.20.
    await expect(page.getByText('€20.00').first()).toBeVisible()
    await expect(page.getByTestId('product-stock')).toContainText('5')
    await expect(page.getByTestId('product-total')).toHaveText('€24.20')

    // Quantity stepper bumps the total. 2000 × 2 × 1.21 = 4840 → €48.40.
    await page.getByTestId('qty-increase').click()
    await expect(page.getByTestId('qty-value')).toHaveText('2')
    await expect(page.getByTestId('product-total')).toHaveText('€48.40')

    // Anonymous Comprar redirects to login with `next` query
    await page.getByTestId('product-buy').click()
    await expect(page).toHaveURL(new RegExp(`/login\\?next=`))
  })

  test('home "Ver catálogo" CTA navigates to /catalogo', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('home-view-catalog').click()
    await expect(page).toHaveURL('/catalogo')
  })

  test('product with sale_price shows strikethrough + discounted price + IVA total', async ({
    page,
  }) => {
    const product = seedProduct({
      name: 'Llavero Oferta',
      description: 'Edición rebajada',
      price_cents: 2000,
      sale_price_cents: 1200,
      stock_quantity: 5,
    })

    // Grid: card shows the sale price block (strikethrough + discounted).
    await page.goto('/catalogo')
    const card = page.getByTestId(`product-card-${product.slug}`)
    await expect(card.getByTestId('product-card-sale-price')).toBeVisible()
    await expect(card).toContainText('€20.00') // crossed-out original
    await expect(card).toContainText('€12.00') // discounted

    // Detail: same treatment + cart total uses the discounted price × 1.21.
    await page.goto(`/catalogo/${product.slug}`)
    await expect(page.getByTestId('product-sale-price')).toBeVisible()
    // 1200 × 1 × 1.21 = 1452 → €14.52
    await expect(page.getByTestId('product-total')).toHaveText('€14.52')
  })
})
