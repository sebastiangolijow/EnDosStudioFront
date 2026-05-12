/**
 * Upload-flow spec — the home → editor → drop-file → canvas pipeline.
 *
 * UploadView used to be a dedicated screen between the home page and
 * the editor. After feedback from the 2026-05-11 client demo, it was
 * collapsed into the editor's empty state: the customer clicks
 * "Subir mi diseño" on home → a draft is created → editor opens with
 * an UploadDropzone where the canvas would be → file dropped uploads
 * + transitions to canvas.
 *
 * This spec covers that flow end-to-end. /upload itself is now a
 * redirect stub for backwards compat (external bookmarks); test that
 * separately.
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

test.describe('upload flow (home → editor empty state)', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  // The editor loads OpenCV.js (~10 MB). Block it at the CDN so Playwright
  // doesn't hang on subresources — the editor spec covers OpenCV explicitly.
  test.beforeEach(async ({ page }) => {
    await page.route('**/opencv.js', (route) => route.abort())
  })

  test('home → click Subir mi diseño → editor empty state → drop file → canvas mounts', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const accessToken = await loginAs(page, customer)

    // Customer lands on home, clicks the hero CTA. A draft is created
    // and they're routed straight into the editor (no intermediate
    // upload screen).
    await page.goto('/')
    await page.getByTestId('home-view-new-sticker').click()
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 10_000 })

    // Editor renders the empty-state dropzone, NOT the canvas, because
    // the draft has no `original` file yet.
    await expect(page.getByTestId('editor-empty-state')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('upload-dropzone')).toBeVisible()

    // Drop the file via the hidden <input type=file>.
    await page.getByTestId('upload-input').setInputFiles(FIXTURE)

    // The empty state disappears, replaced by the canvas stack.
    await expect(page.getByTestId('editor-empty-state')).toHaveCount(0, {
      timeout: 10_000,
    })
    await expect(page.getByTestId('editor-fx-canvas')).toBeVisible({ timeout: 10_000 })

    // Verify the backend has the file attached to the draft.
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
    const original = order.files.find((f: { kind: string }) => f.kind === 'original')
    expect(original).toBeDefined()
    expect(original.size_bytes).toBeGreaterThan(0)
    expect(original.mime_type).toContain('image')
  })

  test('legacy /upload route still works as a redirect → editor', async ({ page }) => {
    const customer = seedActiveCustomer()
    await loginAs(page, customer)

    await page.goto('/upload')
    // UploadView's onMounted creates a draft and pushes to /editor/{uuid}.
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 10_000 })
    await expect(page.getByTestId('editor-empty-state')).toBeVisible({ timeout: 10_000 })
  })

  test('redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/upload')
    await expect(page).toHaveURL(/\/login/)
  })
})
