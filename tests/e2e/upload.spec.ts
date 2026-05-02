/**
 * Upload spec — does the upload screen actually create a draft order on the
 * backend, attach the original file, and route to the editor?
 *
 * REQUIRES the Django backend running (`make up` in the backend repo).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import {
  cleanupSeededUsers,
  expectBackendUp,
  seedActiveCustomer,
  type SeededCustomer,
} from './helpers/backend'

/** Programmatic login — same pattern as dashboard.spec. */
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

const FIXTURE = path.join(__dirname, 'fixtures/sample-design.png')

test.describe('upload', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('full flow: pick file → preview → continue → editor', async ({ page }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)

    await page.goto('/upload')

    // Stepper: step 1 active
    await expect(page.getByText('Subir diseño')).toBeVisible()

    // Dropzone visible, no preview yet
    await expect(page.getByTestId('upload-dropzone')).toBeVisible()
    await expect(page.getByTestId('file-preview')).not.toBeVisible()

    // Continuar disabled before a file is selected
    const continueBtn = page.getByRole('button', { name: /Continuar/ })
    await expect(continueBtn).toBeDisabled()

    // Select the fixture via the hidden <input type=file>
    await page.getByTestId('upload-input').setInputFiles(FIXTURE)

    // Preview now visible, dropzone gone
    await expect(page.getByTestId('file-preview')).toBeVisible()
    await expect(page.getByText('sample-design.png')).toBeVisible()
    await expect(page.getByText('200 × 200 px')).toBeVisible()

    // Continuar now enabled
    await expect(continueBtn).toBeEnabled()
    await continueBtn.click()

    // Should land on /editor/{uuid}
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 10_000 })

    // Verify the backend has the draft + file attached
    const url = page.url()
    const orderUuid = url.match(/\/editor\/([0-9a-f-]{36})$/)![1]

    const orderRes = await page.request.get(
      `http://localhost:8000/api/v1/orders/${orderUuid}/`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    expect(orderRes.ok()).toBeTruthy()
    const order = await orderRes.json()
    expect(order.uuid).toBe(orderUuid)
    expect(order.status).toBe('draft')
    expect(order.files).toHaveLength(1)
    expect(order.files[0].kind).toBe('original')
    expect(order.files[0].size_bytes).toBeGreaterThan(0)
    expect(order.files[0].mime_type).toContain('image')
  })

  test('remove button restores the dropzone', async ({ page }) => {
    const customer = seedActiveCustomer()
    await loginAs(page, customer)
    await page.goto('/upload')

    await page.getByTestId('upload-input').setInputFiles(FIXTURE)
    await expect(page.getByTestId('file-preview')).toBeVisible()

    await page.getByTestId('file-preview-remove').click()

    // Back to dropzone, no preview, button disabled
    await expect(page.getByTestId('upload-dropzone')).toBeVisible()
    await expect(page.getByTestId('file-preview')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /Continuar/ })).toBeDisabled()
  })

  test('redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/upload')
    await expect(page).toHaveURL(/\/login/)
  })
})
