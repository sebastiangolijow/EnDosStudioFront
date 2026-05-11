/**
 * Undo / Redo (Model A — checkpoint-based history) spec.
 *
 * What we exercise:
 *   - Initial state: both buttons disabled.
 *   - Make a checkpoint-triggering change (pick material, pick shape).
 *     Deshacer becomes enabled.
 *   - Click Deshacer: state reverts.
 *   - Rehacer becomes enabled.
 *   - Click Rehacer: state re-applies.
 *   - Stack respects two consecutive changes (material → shape → undo → undo).
 *
 * What we DON'T exercise here:
 *   - Auto cut / smart-cut checkpoints (those have async pipelines —
 *     covered indirectly by the smart-cut spec since checkpoint pushes
 *     don't affect smart-cut's tested behaviors).
 *   - Slider drags NOT creating checkpoints (would need to drag the
 *     margin slider then verify undo doesn't step per-tick — possible
 *     but adds complexity for a property we have higher-confidence in
 *     via the explicit fromToolbar flag).
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

test.describe('editor undo/redo', () => {
  test.setTimeout(60_000)
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await page.route('**/opencv.js', (route) => route.abort())
  })

  test.beforeAll(() => {
    expectBackendUp()
  })
  test.afterAll(() => {
    cleanupSeededUsers()
  })

  test('Deshacer + Rehacer start disabled, enable after a checkpoint action', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('tool-deshacer')).toBeVisible({ timeout: 10_000 })

    // Initial: both disabled.
    await expect(page.getByTestId('tool-deshacer')).toBeDisabled()
    await expect(page.getByTestId('tool-rehacer')).toBeDisabled()

    // Pick a material — checkpoint moment.
    await page.getByTestId('inspector-material-vinilo_blanco').click()
    await expect(page.getByTestId('tool-deshacer')).toBeEnabled({ timeout: 5_000 })
    await expect(page.getByTestId('tool-rehacer')).toBeDisabled()

    // Undo — material clears, Deshacer disabled again, Rehacer enabled.
    await page.getByTestId('tool-deshacer').click()
    await expect(page.getByTestId('tool-rehacer')).toBeEnabled({ timeout: 5_000 })
    await expect(page.getByTestId('tool-deshacer')).toBeDisabled()

    // Redo — material reapplied, Rehacer disabled, Deshacer enabled.
    await page.getByTestId('tool-rehacer').click()
    await expect(page.getByTestId('tool-deshacer')).toBeEnabled({ timeout: 5_000 })
    await expect(page.getByTestId('tool-rehacer')).toBeDisabled()
  })

  test('two consecutive checkpoints walk back individually', async ({ page }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('tool-deshacer')).toBeVisible({ timeout: 10_000 })

    // First checkpoint: material
    await page.getByTestId('inspector-material-vinilo_blanco').click()
    // Second checkpoint: shape
    await page.getByTestId('inspector-shape-cuadrado').click()

    // Undo first (cuadrado → contorneado), still material picked, Deshacer enabled
    await page.getByTestId('tool-deshacer').click()
    await expect(page.getByTestId('tool-deshacer')).toBeEnabled()

    // Undo second (material clears), Deshacer disabled
    await page.getByTestId('tool-deshacer').click()
    await expect(page.getByTestId('tool-deshacer')).toBeDisabled({ timeout: 5_000 })
    // Rehacer has two redos available
    await expect(page.getByTestId('tool-rehacer')).toBeEnabled()
  })

  test('Borrar pushes a checkpoint so undo restores pre-Borrar state', async ({
    page,
  }) => {
    const customer = seedActiveCustomer()
    const access = await loginAs(page, customer)
    const uuid = await seedDraftWithImage(page, access, customer)

    await page.goto(`/editor/${uuid}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('tool-deshacer')).toBeVisible({ timeout: 10_000 })

    // Pick a material so there's something to lose
    await page.getByTestId('inspector-material-vinilo_blanco').click()
    await expect(page.getByTestId('tool-deshacer')).toBeEnabled()

    // Borrar resets everything — but undo should bring the material back
    await page.getByTestId('tool-borrar').click()
    await expect(page.getByTestId('tool-deshacer')).toBeEnabled({ timeout: 5_000 })
    await page.getByTestId('tool-deshacer').click()
    // Material card should be selected again
    await expect(
      page.getByTestId('inspector-material-vinilo_blanco'),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
