# Playwright e2e specs

This directory holds end-to-end tests that exercise the real Vite dev server
in a real Chromium browser. See the `playwright-frontend-test` skill for the
full conventions.

## Running

```sh
npm run e2e          # headless
npm run e2e:ui       # Playwright's GUI runner
```

`playwright.config.ts` boots `npm run dev` automatically. **The Django backend
is NOT booted by the config** — start it manually before running specs that hit
the API:

```sh
# In the backend repo
make up
```

## Spec inventory

| File | What it covers |
|---|---|
| `auth-pages.spec.ts` | Auth views render, navigation between them works, form validation fires. Does NOT exercise the full backend roundtrip. |

## TODO: backend-coordinated specs

The next layer of specs needs to seed/teardown backend state per test. Options:

1. A **dev-only Django management command** like `python manage.py issue_test_token <email>` that returns the verification or password-reset token. The test calls it via `child_process.exec`. Cleanest for local development; safe because the command isn't registered in production settings.
2. A **test-only DRF endpoint** like `POST /api/v1/test/users/{email}/issue-token/` mounted only when `DEBUG=True`. Easier to invoke from Playwright via `page.request`; requires a tiny backend addition.
3. **`stripe listen`-style webhook capture** for the verification email — Mailpit / MailHog running alongside the backend so the test reads the email directly. Most realistic but heaviest setup.

Pick the option that's cheapest *for the test we need next*. The full
register → set-password → login → /me/ roundtrip (the M2 backend gate test
mirrored client-side) wants option 1 or 2 — option 3 is overkill for one spec.
