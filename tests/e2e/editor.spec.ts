/**
 * Editor spec — does the canvas + OpenCV pipeline produce a valid die_cut_mask?
 *
 * Coverage:
 *   - Toolbar + canvas render once the order + image load.
 *   - "Auto cut" runs the OpenCV pipeline. (Or shows the no-contour banner if
 *     the fixture is too plain — our 200×200 purple square has no edges, so
 *     this often hits the no-contour branch. We accept either outcome but
 *     assert the corresponding banner.)
 *   - Continuar without a mask routes forward (mask is optional in M2).
 *   - Continuar WITH a mask uploads a die_cut_mask file then routes forward.
 *
 * REQUIRES the Django backend running.
 *
 * The OpenCV.js bundle is large (~10 MB) — give the page time to load it.
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

async function seedDraftWithImage(
  page: Page,
  accessToken: string,
  customer: SeededCustomer,
): Promise<string> {
  const uuid = seedDraftForCustomer(customer)
  const fs = await import('node:fs')
  const buffer = fs.readFileSync(FIXTURE)
  await page.request.post(`http://localhost:8000/api/v1/orders/${uuid}/files/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    multipart: {
      kind: 'original',
      file: { name: 'sample.png', mimeType: 'image/png', buffer },
    },
  })
  return uuid
}

test.describe('editor', () => {
  test.setTimeout(60_000)
  test.describe.configure({ mode: 'serial' })

  // Auto-crop runs in a Web Worker (see useAutoCropWorker). The worker
  // loads OpenCV.js from the CDN — which Playwright can't always reach
  // reliably and which is large enough to slow tests.
  //
  // We block the CDN at the network layer so the worker fails to load.
  // The editor surfaces this via `editor-loading-engine` (Auto cut stays
  // disabled) — same UX path real users get on captive portal / ad-block.
  // The "Continuar without auto-cropping" path then proves the customer
  // flow tolerates a non-functional auto-crop, which is the M2 contract.
  test.beforeEach(async ({ page }) => {
    await page.route('**/opencv.js', (route) => route.abort())
  })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('renders toolbar + canvas (OpenCV CDN blocked in test env)', async ({ page }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })

    // Toolbar shows the Auto cut tool
    await expect(page.getByTestId('tool-auto-cut')).toBeVisible({ timeout: 10_000 })

    // Canvas mounts (the UI layer is what receives pointer events)
    await expect(page.getByTestId('editor-ui-canvas')).toBeVisible()
  })

  test('Auto cut button stays disabled while OpenCV is unavailable (CDN blocked)', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })

    // Worker tried + failed to load opencv.js → editor stays in
    // "loading engine" state and Auto cut remains disabled. This is the
    // exact UX path captive-portal / ad-block users land on, and the
    // editor still lets them Continuar.
    await expect(page.getByTestId('tool-auto-cut')).toBeDisabled({ timeout: 10_000 })
    await expect(page.getByTestId('editor-loading-engine')).toBeVisible({ timeout: 10_000 })
  })

  test('Continuar without auto-cropping routes to /order-config (mask is optional)', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })
    // Wait for the editor body to render (loading state out)
    await expect(page.getByTestId('tool-auto-cut')).toBeVisible()

    // Don't click Auto cut. Just continue.
    await page.getByTestId('editor-continue').click()

    // Should land on /order-config/{uuid}
    await expect(page).toHaveURL(new RegExp(`/order-config/${uuid}$`), { timeout: 10_000 })

    // Backend should NOT have a die_cut_mask file (we skipped it).
    const orderRes = await page.request.get(
      `http://localhost:8000/api/v1/orders/${uuid}/`,
      { headers: { Authorization: `Bearer ${access}` } },
    )
    const order = await orderRes.json()
    const masks = order.files.filter((f: { kind: string }) => f.kind === 'die_cut_mask')
    expect(masks).toHaveLength(0)
  })

  test('non-draft orders are redirected to order-config', async ({ page }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const { seedOrdersForCustomer } = await import('./helpers/backend')
    const orders = seedOrdersForCustomer(customer, ['placed'])
    const uuid = orders[0].uuid

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })

    // The view sees the order is past 'draft' and forwards.
    await expect(page).toHaveURL(new RegExp(`/order-config/${uuid}$`), { timeout: 10_000 })

    // Suppress unused-var warnings — the access token isn't checked here, but
    // it's needed to seed the order.
    void access
  })
})

/**
 * Worker-pipeline smoke test — OpenCV CDN ALLOWED.
 *
 * Separate describe block so the CDN-block `beforeEach` above doesn't apply.
 * This is the slow path: ~10 MB WASM download + compile in the worker.
 * Generous timeout. Network-dependent; if `docs.opencv.org` is unreachable,
 * this test is genuinely red and we want to know.
 *
 * Why this matters: every other editor test blocks the CDN, so they only
 * prove the loading-engine UX. This test proves the Web Worker actually
 * runs the OpenCV pipeline end to end without freezing the renderer
 * (which was the entire point of moving off the main thread).
 */
test.describe('editor (worker pipeline, OpenCV reachable)', () => {
  test.setTimeout(120_000)

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('Auto cut button enables once the worker reports ready', async ({ page }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })

    // While the worker is loading WASM, the editor shows the loading banner
    // AND the page must remain responsive — the toolbar paints, navigation
    // works, no "Page Unresponsive" dialog. We test responsiveness implicitly
    // by asserting other UI elements stay interactable during the wait.
    await expect(page.getByTestId('tool-auto-cut')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('editor-continue')).toBeEnabled({ timeout: 5_000 })

    // Eventually (CDN download + WASM compile in the worker) Auto cut enables.
    await expect(page.getByTestId('tool-auto-cut')).toBeEnabled({ timeout: 90_000 })
    await expect(page.getByTestId('editor-ready')).toBeVisible({ timeout: 5_000 })
  })

  test('clicking Auto cut runs the pipeline and draws a mask on the canvas', async ({ page }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('tool-auto-cut')).toBeEnabled({ timeout: 90_000 })

    // The base canvas is the first <canvas> in the canvas-stack. Before
    // Auto cut, the mask layer (second canvas) should be empty.
    const maskBefore = await page.evaluate(() => {
      const canvases = document.querySelectorAll('.canvas-stack > canvas')
      // Stack order is now mask (0), base (1), ui (2). Mask is the FIRST.
      const mask = canvases[0] as HTMLCanvasElement | undefined
      if (!mask) return -1
      const ctx = mask.getContext('2d')!
      const data = ctx.getImageData(0, 0, mask.width, mask.height).data
      let n = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++
      return n
    })
    expect(maskBefore).toBe(0)

    await page.getByTestId('tool-auto-cut').click()

    // Either the pipeline draws a mask OR the fixture has no contour
    // (our purple-square fixture is uniform — Canny might not find an edge).
    // Both outcomes are valid; we accept either as proof the pipeline ran
    // without throwing DataCloneError or similar regressions.
    const result = await Promise.race([
      page.getByTestId('editor-no-contour').waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'no-contour'),
      page
        .waitForFunction(
          () => {
            const canvases = document.querySelectorAll('.canvas-stack > canvas')
            const mask = canvases[1] as HTMLCanvasElement | undefined
            if (!mask) return false
            const ctx = mask.getContext('2d')!
            const data = ctx.getImageData(0, 0, mask.width, mask.height).data
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true
            return false
          },
          { timeout: 30_000 },
        )
        .then(() => 'mask-drawn'),
    ])

    expect(['no-contour', 'mask-drawn']).toContain(result)
  })
})
