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
export function seedActiveCustomer(
  options: {
    email?: string
    first_name?: string
    last_name?: string
    can_reserve_orders?: boolean
  } = {},
): SeededCustomer {
  const suffix = Math.random().toString(36).slice(2, 10)
  const email = options.email ?? `e2e-${suffix}@example.com`
  const password = 'TestPass123!'
  const firstName = options.first_name ?? 'E2E'
  const lastName = options.last_name ?? 'Test'
  const canReserve = options.can_reserve_orders ?? false

  // Multi-statement Python: create user + matching EmailAddress (without that
  // row, allauth silently rejects login — see backend CLAUDE.md "EmailAddress trap").
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.users.models import User',
    'from allauth.account.models import EmailAddress',
    `u = User.objects.create_user(email='${email}', password='${password}', role='customer', is_active=True, is_verified=True, first_name='${firstName}', last_name='${lastName}', phone_number='+34 600 000 000', can_reserve_orders=${canReserve ? 'True' : 'False'})`,
    `EmailAddress.objects.create(user=u, email='${email}', verified=True, primary=True)`,
  ].join('; ')

  runInBackendShell(code)
  seededInThisFile.push(email)
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

export interface SeededProduct {
  uuid: string
  slug: string
}

/** Sanitize free-text fields for use in a single-line Python shell-out.
 *  Strips characters that would break the surrounding quoting (newlines,
 *  single quotes, backslashes). For E2E test fixtures, keep descriptions
 *  ASCII-printable on a single line. */
function sanitizeForPythonString(value: string): string {
  return value.replace(/[\r\n\\']/g, ' ').trim()
}

/** Create a Product row directly via the ORM. Returns uuid + slug. */
export function seedProduct(opts: {
  name: string
  price_cents: number
  stock_quantity: number
  description?: string
  is_active?: boolean
  sale_price_cents?: number
}): SeededProduct {
  const name = sanitizeForPythonString(opts.name)
  const description = sanitizeForPythonString(opts.description ?? '')
  const isActive = opts.is_active ?? true
  const salePart
    = opts.sale_price_cents !== undefined
      ? `, sale_price_cents=${opts.sale_price_cents}`
      : ''
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.products.models import Product',
    `p = Product.objects.create(name='${name}', description='${description}', price_cents=${opts.price_cents}, stock_quantity=${opts.stock_quantity}, is_active=${isActive ? 'True' : 'False'}${salePart})`,
    'print(f"{p.uuid}|{p.slug}")',
  ].join('; ')
  const out = runInBackendShell(code)
  const [uuid, slug] = out.split('|')
  seededProductsInThisFile.push(uuid)
  return { uuid, slug }
}

/** Seed a shop_staff user (for admin-flow specs). */
export function seedShopStaff(): SeededCustomer {
  const suffix = Math.random().toString(36).slice(2, 10)
  const email = `e2e-staff-${suffix}@example.com`
  const password = 'TestPass123!'
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.users.models import User',
    'from allauth.account.models import EmailAddress',
    `u = User.objects.create_user(email='${email}', password='${password}', role='shop_staff', is_active=True, is_verified=True)`,
    `EmailAddress.objects.create(user=u, email='${email}', verified=True, primary=True)`,
  ].join('; ')
  runInBackendShell(code)
  seededInThisFile.push(email)
  return { email, password }
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

/**
 * Create an Order at a specific status with the gold-standard sticker
 * spec. Used by admin-orders specs that exercise transitions
 * (placed→paid via mark-paid, paid→in_production, etc.).
 */
export function seedOrderForCustomer(
  customer: SeededCustomer,
  options: { status?: string; with_original_file?: boolean } = {},
): string {
  const status = options.status ?? 'placed'
  const withOriginal = options.with_original_file ?? false
  const fileLines = withOriginal
    ? [
        'from django.core.files.base import ContentFile',
        'from apps.orders.models import OrderFile',
        "f = ContentFile(b'\\x89PNG fake', name='test.png')",
        "OrderFile.objects.create(order=o, kind='original', file=f, created_by=u)",
      ]
    : []
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.users.models import User',
    'from apps.orders.models import Order',
    `u = User.objects.get(email='${customer.email}')`,
    [
      'o = Order.objects.create(',
      'created_by=u,',
      `status='${status}',`,
      "material='vinilo_blanco',",
      'width_mm=100, height_mm=100, quantity=100,',
      'total_amount_cents=11000,',
      "recipient_name='Test Recipient',",
      "street_line_1='Carrer 1',",
      "city='Barcelona', postal_code='08001', country='ES',",
      // shipping_phone is required at place_order — fill it so tests
      // that exercise the placed-or-beyond states don't trip the
      // place_order guard.
      "shipping_phone='+34 600 123 456',",
      ')',
    ].join(' '),
    ...fileLines,
    'print(o.uuid)',
  ].join('; ')
  return runInBackendShell(code).trim()
}

/**
 * Track customers seeded by the current test file so `cleanupSeededUsers()`
 * only removes the ones THIS file created.
 *
 * Without this, two specs running in parallel (e.g. dashboard.spec + upload.spec)
 * step on each other's data when one's afterAll fires while the other is mid-test.
 */
const seededInThisFile: string[] = []
const seededProductsInThisFile: string[] = []

/** Delete users (and seeded products) seeded by THIS test file only. Call from `afterAll`. */
export function cleanupSeededUsers(): void {
  // Products first (FK from Order.product PROTECT — but seeded customers
  // have no orders attached to seeded products in the typical spec, so
  // this delete is safe; if a spec did create orders, it should null
  // the FK first).
  if (seededProductsInThisFile.length > 0) {
    const idList = seededProductsInThisFile.map((u) => `'${u}'`).join(',')
    const code = [
      "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
      'import django; django.setup()',
      'from apps.products.models import Product',
      'from apps.orders.models import Order',
      // Detach orders from products so the PROTECT FK doesn't block delete.
      `Order.objects.filter(product__uuid__in=[${idList}]).update(product=None, product_quantity=0)`,
      `Product.objects.filter(uuid__in=[${idList}]).delete()`,
    ].join('; ')
    runInBackendShell(code)
    seededProductsInThisFile.length = 0
  }

  if (seededInThisFile.length > 0) {
    const emailList = seededInThisFile.map((e) => `'${e}'`).join(',')
    const code = [
      "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
      'import django; django.setup()',
      'from apps.users.models import User',
      `User.objects.filter(email__in=[${emailList}]).delete()`,
    ].join('; ')
    runInBackendShell(code)
    seededInThisFile.length = 0
  }
}

/**
 * Nuke ALL e2e users (used by the cleanup script run before a full suite to
 * wipe stale data from prior crashed runs). Don't call from a spec's afterAll.
 */
export function cleanupAllE2EUsers(): void {
  const code = [
    "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')",
    'import django; django.setup()',
    'from apps.users.models import User',
    "User.objects.filter(email__startswith='e2e-').delete()",
  ].join('; ')
  runInBackendShell(code)
}
