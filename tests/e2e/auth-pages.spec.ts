/**
 * Auth pages spec — does the static auth surface render and navigate correctly?
 *
 * Scope (intentionally narrow for this first spec):
 *   - All 6 auth-related views render without errors
 *   - Internal links between them work
 *   - Form-level validation fires (empty submits, password mismatch on reset)
 *
 * NOT in this spec:
 *   - The full register → set-password → login → /me/ roundtrip. That requires
 *     coordinating with the backend to read the verification token. See
 *     tests/e2e/README.md "TODO: backend-coordinated specs".
 *
 * If this spec breaks, something fundamental is wrong: a route is misconfigured,
 * a view file fails to compile, or a critical link points at the wrong target.
 */
import { test, expect } from '@playwright/test'

test.describe('auth pages', () => {
  test('home → login: clicking "Iniciar sesión" goes to /login', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Iniciar sesión' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Entra a tu cuenta' })).toBeVisible()
  })

  test('login → register: the "Crear cuenta" link routes to /register', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Crear cuenta' }).click()
    await expect(page).toHaveURL(/\/register$/)
    await expect(page.getByRole('heading', { name: 'Crear cuenta' })).toBeVisible()
  })

  test('login → forgot-password: the link routes correctly', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await expect(page.getByRole('heading', { name: 'Recuperá tu contraseña' })).toBeVisible()
  })

  test('forgot-password → login: "Volver al login" link works', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByRole('link', { name: 'Volver al login' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('set-password without query params shows the invalid-link error', async ({ page }) => {
    await page.goto('/set-password')
    await expect(
      page.getByText('Enlace inválido. Pedí uno nuevo desde la pantalla de registro.'),
    ).toBeVisible()
  })

  test('reset-password without query params shows the invalid-link error', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(
      page.getByText('Enlace inválido. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".'),
    ).toBeVisible()
  })

  test('reset-password: mismatched passwords show inline error and disable submit', async ({
    page,
  }) => {
    // Provide the URL params so the form actually renders
    await page.goto('/reset-password?uid=fake&token=fake')

    // Two password inputs; address them by their type+autocomplete + nth().
    // (`getByLabel` is ambiguous because both labels start with "Nueva".)
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill('OnePassword123!')
    await passwordInputs.nth(1).fill('Different456!')

    await expect(page.getByText('Las contraseñas no coinciden.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar contraseña' })).toBeDisabled()
  })

  test('protected route /dashboard redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
    // The router preserves the intended destination as ?next= (Vue Router doesn't
    // URL-encode the slash in this case, so the literal `/dashboard` is fine).
    await expect(page).toHaveURL(/next=\/dashboard/)
  })
})
