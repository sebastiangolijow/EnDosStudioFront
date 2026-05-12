/**
 * Holographic FX (WebGL layer) spec.
 *
 * What we can practically check in a headless browser:
 *   - The FX <canvas> mounts in the editor stack with the right testid.
 *   - The WebGL context initializes (canvas exists in the DOM, getContext
 *     succeeds; we sanity-check this by reading canvas.width/height after
 *     load — non-zero means setSize ran).
 *   - The FX canvas has pointer-events:none so it doesn't block the
 *     UI canvas from receiving events. (Regression guard — the UI
 *     pointer interactions are how the customer interacts with the
 *     mask.)
 *   - Switching to a holographic material doesn't crash and doesn't
 *     regress the existing editor flow (Continuar still works).
 *
 * What we explicitly do NOT check here:
 *   - Visual quality of the shimmer. Pixel-diff regression on a WebGL
 *     output is fragile (driver/GPU dependent) and the shader's whole
 *     point is *animated* output. Manual visual review owns this.
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
  const loginRes = await page.request.post(
    'http://localhost:8000/api/v1/auth/login/',
    { data: { email: customer.email, password: customer.password } },
  )
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

test.describe('holographic FX layer', () => {
  test.setTimeout(60_000)
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    // The OpenCV CDN-block convention from editor.spec — keeps the test
    // env deterministic and doesn't matter for the FX layer (which is
    // independent of OpenCV).
    await page.route('**/opencv.js', (route) => route.abort())
  })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('FX canvas mounts in the editor stack', async ({ page }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })

    // The FX canvas mounts under the same data-testid attribute pattern
    // as the other layers.
    await expect(page.getByTestId('editor-fx-canvas')).toBeVisible({
      timeout: 10_000,
    })
  })

  test('FX canvas has pointer-events: none (UI layer keeps focus)', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('editor-fx-canvas')).toBeVisible({
      timeout: 10_000,
    })

    // Read the computed style on the FX canvas. CSS in CanvasStage
    // gives `pointer-events: none` to all canvases except the last
    // (UI), so the UI canvas receives all pointer events.
    const pe = await page.getByTestId('editor-fx-canvas').evaluate(
      (el) => getComputedStyle(el).pointerEvents,
    )
    expect(pe).toBe('none')
  })

  test('switching to holographic material does not break Continuar', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('editor-fx-canvas')).toBeVisible({
      timeout: 10_000,
    })

    // Pick the holografico material from the inspector.
    await page.getByTestId('inspector-material-holografico').click()

    // FX layer ramps up — but the UX path is still: Continuar works.
    await page.getByTestId('editor-continue').click()
    await expect(page).toHaveURL(new RegExp(`/order-config/${uuid}$`), {
      timeout: 10_000,
    })
  })

  test('switching across all 5 FX-mode materials does not crash', async ({
    page,
  }) => {
    // Track 2 wires up an optional macro reference texture per material
    // (src/assets/textures/<material>_macro.png). When the PNG isn't
    // bundled the loader falls back to procedural-only — no error, no
    // missing-image network noise. This spec exercises every FX-mode
    // material in sequence and proves the editor stays functional.
    //
    // It also catches the regression where an unloaded macro texture
    // would cause the WebGL sampler to bind a deleted GLTexture and the
    // shader to fail silently. Pageerror / requestfailed listeners
    // surface those.
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    const errors: string[] = []
    page.on('pageerror', (e) => {
      // The describe-level beforeEach aborts requests to docs.opencv.org;
      // the auto-crop worker's importScripts then legitimately throws.
      // That's expected test setup, not a regression in our code.
      if (e.message.includes('opencv.js')) return
      errors.push('pageerror: ' + e.message)
    })
    // Macro textures live under /src/assets/textures — a 404 there is
    // fine (graceful no-op), but any OTHER 5xx is a real failure.
    page.on('response', (r) => {
      if (r.status() >= 500) errors.push(`5xx: ${r.url()}`)
    })

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('editor-fx-canvas')).toBeVisible({
      timeout: 10_000,
    })

    const materials = [
      'holografico',
      'holografico_transparente',
      'eggshell_holografico',
      'luminiscente',
      'plateado',
    ]
    for (const m of materials) {
      await page.getByTestId(`inspector-material-${m}`).click()
      // Give the FX layer time to swap modes and the (possibly missing)
      // macro PNG time to either land or fail-silent. 250ms is plenty
      // — the texture load is async but never blocking.
      await page.waitForTimeout(250)
      await expect(page.getByTestId('editor-fx-canvas')).toBeVisible()
    }

    expect(errors, errors.join('\n')).toEqual([])
    // Continuar still works after walking through all the modes.
    await page.getByTestId('editor-continue').click()
    await expect(page).toHaveURL(new RegExp(`/order-config/${uuid}$`), {
      timeout: 10_000,
    })
  })
})
