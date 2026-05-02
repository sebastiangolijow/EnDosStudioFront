/**
 * Backend test helpers — orchestrate Django state from Playwright tests
 * via `docker compose exec` shell-outs to the backend container.
 *
 * Why this approach: the customer flow requires email-verification + set-password
 * before login works. Reproducing that in every test is slow and brittle.
 * Bypassing via a direct shell command is fast, deterministic, and isolated to
 * the test runtime (the backend code itself is untouched).
 *
 * Prerequisite: the backend is running (`make up` in the backend repo).
 *
 * If the backend isn't running, these helpers throw — the spec should skip
 * itself rather than fail confusingly. Use `expectBackendUp()` in `beforeAll`.
 */
import { execSync } from 'node:child_process'

const BACKEND_DIR = '/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend'

/** Run an arbitrary one-line Python snippet inside the backend container. Returns stdout. */
function runInBackendShell(code: string): string {
  // -T disables TTY allocation (required for non-interactive shells).
  const escaped = code.replace(/"/g, '\\"')
  const cmd = `cd ${BACKEND_DIR} && docker compose exec -T web python -c "${escaped}"`
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message: string }
    const detail = (e.stderr?.toString() ?? e.stdout?.toString() ?? e.message).trim()
    throw new Error(`backend shell failed: ${detail}`)
  }
}

/** Throws if the backend container isn't responsive. Call from `beforeAll` to guard. */
export function expectBackendUp(): void {
  try {
    execSync(
      `cd ${BACKEND_DIR} && docker compose exec -T web python manage.py check 2>&1`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch {
    throw new Error(
      'Backend container is not running. Start it with `make up` in the backend repo.',
    )
  }
}

export interface SeededCustomer {
  email: string
  password: string
}

/**
 * Create an active customer with a verified email + EmailAddress row.
 * Returns the credentials so the test can log in via the UI.
 *
 * Each call generates a unique email so concurrent tests don't collide.
 */
export function seedActiveCustomer(): SeededCustomer {
  const suffix = Math.random().toString(36).slice(2, 10)
  const email = `e2e-${suffix}@example.com`
  const password = 'TestPass123!'

  // Multi-statement Python: create user + matching EmailAddress (without that
  // row, allauth silently rejects login — see backend CLAUDE.md "EmailAddress trap").
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.users.models import User',
    'from allauth.account.models import EmailAddress',
    `u = User.objects.create_user(email='${email}', password='${password}', role='customer', is_active=True, is_verified=True, first_name='E2E', last_name='Test')`,
    `EmailAddress.objects.create(user=u, email='${email}', verified=True, primary=True)`,
  ].join('; ')

  runInBackendShell(code)
  return { email, password }
}

export interface SeededOrder {
  uuid: string
  status: string
}

/**
 * Seed N orders for a customer in various statuses. Returns the order UUIDs
 * so tests can assert on them.
 *
 * Each order gets sane sticker spec (vinilo_blanco 5×5cm × 50). Bypasses the
 * place_order service layer and writes status directly — these are test
 * fixtures, not real lifecycle events.
 */
export function seedOrdersForCustomer(
  customer: SeededCustomer,
  statuses: ReadonlyArray<'placed' | 'paid' | 'in_production' | 'shipped' | 'delivered' | 'cancelled'>,
): SeededOrder[] {
  const baseFields =
    "material='vinilo_blanco', width_mm=50, height_mm=50, quantity=50, " +
    "recipient_name='Test', street_line_1='C/ Test 1', city='Barcelona', " +
    "postal_code='08001', country='ES', total_amount_cents=10500, currency='EUR'"

  const lines: string[] = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from django.utils import timezone',
    'from apps.users.models import User',
    'from apps.orders.models import Order',
    `u = User.objects.get(email='${customer.email}')`,
    'now = timezone.now()',
  ]

  statuses.forEach((status, i) => {
    const ts: string[] = ['placed_at=now']
    if (status === 'paid' || status === 'in_production' || status === 'shipped' || status === 'delivered')
      ts.push('paid_at=now')
    if (status === 'shipped' || status === 'delivered') ts.push('shipped_at=now')
    if (status === 'delivered') ts.push('delivered_at=now')
    if (status === 'cancelled') ts.push('cancelled_at=now')

    lines.push(
      `o${i} = Order.objects.create(created_by=u, status='${status}', ${baseFields}, ${ts.join(', ')})`,
    )
    lines.push(`print(f'${status}|{o${i}.uuid}')`)
  })

  const out = runInBackendShell(lines.join('; '))

  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, uuid] = line.split('|')
      return { status, uuid }
    })
}

/** Create a single draft order (status='draft') for an existing customer. Returns the UUID. */
export function seedDraftForCustomer(customer: SeededCustomer): string {
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.users.models import User',
    'from apps.orders.models import Order',
    `u = User.objects.get(email='${customer.email}')`,
    "o = Order.objects.create(created_by=u, status='draft')",
    'print(o.uuid)',
  ].join('; ')
  return runInBackendShell(code).trim()
}

/** Delete all e2e users (and cascade their orders). Call from `afterAll` to keep the DB tidy. */
export function cleanupSeededUsers(): void {
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.users.models import User',
    "User.objects.filter(email__startswith='e2e-').delete()",
  ].join('; ')
  runInBackendShell(code)
}
