# StickerApp Frontend — AI Context

> **Studio**: YeKo Studio · **Client**: Barcelona print shop selling custom stickers
> **Stack**: Vue 3 · Vite · TypeScript · Vue Router · Pinia · Tailwind CSS · Axios · Canvas API · OpenCV.js (CDN)
> **Backend**: separate Django + DRF project at `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/` (https://github.com/sebastiangolijow/EnDosStudioApp)
> **Status**: greenfield — no code committed yet. The backend is at M2 (orders + payments + auth shipped, real pricing wired, 48 tests green); this frontend is what closes the loop. CLAUDE.md is the source of truth until the bootstrap skill runs.

This file is the index for any AI agent working on the StickerApp frontend. Read it before doing anything. It captures the YeKo Studio mindset, the design tokens (locked), the tech-stack decisions, the screen inventory, and the conventions we'll follow.

---

## 🧠 YeKo Studio mindset (non-negotiable)

YeKo builds **operational systems for SMBs that already make money**. The bar is "did we reduce real operational chaos and increase real revenue?"

For this project specifically, the stakes also include **brand experience**. The app must feel like a "Sticker Lab" — dark, premium, energetic, creative — not like a boring ecommerce form. The customer is uploading a design they care about; the UI should match that energy.

When working in this repo:

- **Simple > complex.** Reach for a small Vue component before a giant abstraction. Reach for a composable before a class. Reach for plain `fetch`-style code in services before custom HTTP wrappers.
- **Build first, sell after.** This is a real frontend, not a demo. Every screen should be operational by the end of its phase.
- **Execute, don't theorize.** Ship the obvious answer fast and iterate.
- **Frontend keeps frontend work.** Image edge detection / mask generation / preview compositing all happen in the browser via OpenCV.js + Canvas. The backend stores the resulting files; it does NOT process pixels.
- **No overengineering.** Don't add Vuex on top of Pinia. Don't pre-design abstract base classes. Don't add a UI library "just in case" — Tailwind + a small set of in-house components is the design system.

The 1-line filter: *"If a piece of code doesn't make the user faster or the brand feel better, it isn't worth shipping."*

---

## 🎯 Project spec digest

A SPA that lets a customer upload a design, watch the app auto-detect the cut line, set order specs (material × size × quantity), opt in to relief and varnish, then check out via Stripe.

**Customer flow**:

1. Land on home → "Tu diseño. Tu sticker. Sin límites." → click "Subir mi diseño"
2. Register / login (the design pack mentions guest checkout as a maybe — backend doesn't support it yet; treat as auth-required for MVP)
3. Upload PNG/JPG → drag-drop with size + format validation
4. Editor opens → image renders on canvas → click "Auto cut" → OpenCV detects contour → user accepts/refines
5. **Relief option**: a checkbox `Con relieve`. If checked, opens a free-text note where the customer describes WHERE the relief should go. **Backend stores the boolean + the note. There is NO drawn relief mask in the MVP.** The drawn-mask feature is deferred.
6. Order config → choose material (9 options), width × height in mm (multiples of 5, min 25 mm = 2.5 cm), quantity (20–100 000), optional varnish → live price preview via `GET /api/v1/orders/quote/`
7. Checkout → shipping (recipient name, two street lines, city, postal code, country) + Stripe payment
8. Confirmation → order UUID, link to history
9. Order history → list, detail, cancel (only while draft/placed), mark delivered (only when shipped)

**Admin flow**:
1. Django admin (already wired) is the day-1 ops UI: list orders with filters, see attached files, transition `paid → in_production → shipped` manually
2. A Vue admin UI is post-MVP — only build it once the shop owner has used Django admin for at least a week and has specific complaints

**Auth model**:
- Customers: self-registration → email verification link → set-password form → can log in
- Shop staff / admin: created server-side (Django admin, `make superuser`, or a future invite flow), log in via the same login screen
- The verification email contains a link to `/set-password?token=...&email=...` on this frontend; that view POSTs to the backend's `/api/v1/users/set-password/` endpoint
- Forgot password: `POST /api/v1/auth/password/reset/` (sends email) → email links to `/reset-password?uid=...&token=...` on this frontend → that view POSTs to `/api/v1/auth/password/reset/confirm/`

**Source of truth**: the design pack PDF at `/Users/cevichesmac/Downloads/Stickerapp Frontend Design Pack.pdf`. Move it to `docs/design-pack.md` (or keep PDF) once we scaffold. The PDF supersedes anything in this CLAUDE.md if they conflict.

---

## 🛠️ Stack — locked

| Layer | Choice | Why |
|---|---|---|
| Framework | **Vue 3** (Composition API + `<script setup>`) | Studio default, ecosystem fit, TypeScript-friendly |
| Build tool | **Vite** | Fastest dev experience, ESM-first |
| Language | **TypeScript** | Catches integration bugs cheaply; the editor + state shapes are non-trivial |
| Routing | **Vue Router 4** | Standard, supports route guards for auth |
| State | **Pinia** | The Vue 3 default; simpler than Vuex, TS-friendly |
| Styling | **Tailwind CSS** | Aligns with utility-first speed; design tokens via Tailwind config |
| HTTP | **Axios** | Interceptors make JWT refresh + 401 handling simple |
| Canvas | **Native Canvas API** + **OpenCV.js via CDN** | OpenCV.js handles edge detection; Canvas handles everything else |
| Drawing | Native Canvas first; **Fabric.js only if drawing complexity justifies it** | YAGNI |

### Things explicitly NOT in the stack on day 1

- No state library beyond Pinia (no Redux, no XState yet — the editor state can grow into XState later if it gets complex enough)
- No component library (no Vuetify / PrimeVue / Element Plus) — design is too custom; we own the components
- No CSS-in-JS (no styled-components / Emotion) — Tailwind handles it
- No Storybook on day 1 — add when we have 10+ in-house components and onboarding pain
- No animation library on day 1 (no GSAP, no Framer Motion) — Tailwind transitions + native CSS animations cover the spec; revisit if a complex motion sequence appears
- No backend in this repo — Django backend is separate (see top of file)

---

## 🎨 Design tokens (locked — from §2 of the design pack)

These come from the design pack and are **non-negotiable**. Implement them in `src/styles/tokens.css` + `tailwind.config.ts` and never hardcode hex values in components.

### Colors

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#050708` | Background base (deep black) |
| `--color-surface-1` | `#111418` | Cards, elevated surfaces |
| `--color-surface-2` | `#1B2027` | Secondary elevated surfaces |
| `--color-border` | `#2A3038` | Subtle borders / dividers |
| `--color-text` | `#F5F3EF` | Primary text (warm white) |
| `--color-text-muted` | `#AEB4BD` | Secondary text |
| **`--color-primary`** | **`#FF3D0A`** | **Primary CTA — the EN DOS orange** |
| `--color-primary-hover` | `#FF5A24` | CTA hover |
| `--color-primary-dark` | `#B92808` | CTA pressed / dark variant |
| `--color-cyan` | `#22D3EE` | Holographic accent |
| `--color-violet` | `#A855F7` | Holographic accent |
| `--color-lime` | `#A3E635` | Holographic accent |
| `--color-warning` | `#FACC15` | Warnings |
| `--color-success` | `#22C55E` | Success states |
| `--color-error` | `#EF4444` | Errors |

### Gradients

```css
--gradient-holographic: linear-gradient(135deg, #22D3EE 0%, #A855F7 38%, #FF3D0A 65%, #A3E635 100%);
--gradient-orange-glow: radial-gradient(circle, rgba(255,61,10,.35) 0%, rgba(255,61,10,0) 70%);
```

Use holographic accents **sparingly** — selected MaterialCard borders, hero highlights, hover states. Not on every button.

### Spacing (4px scale)

`xs=4, sm=8, md=16, lg=24, xl=32, 2xl=48, 3xl=64`

### Border radius

`sm=8 (inputs)`, `md=12 (buttons)`, `lg=18 (cards)`, `xl=24 (panels)`, `full=999 (pills)`

### Shadows / glow

```css
--shadow-card: 0 12px 40px rgba(0,0,0,0.35);
--glow-orange: 0 0 24px rgba(255,61,10,0.45);
--glow-cyan: 0 0 24px rgba(34,211,238,0.35);
```

### Typography

- Primary font: **Inter** (or Satoshi / Manrope as alternatives — pick one and stick with it).
- Display optional: a grotesk bold for hero titles only.
- Scale (line height after `/`): Display XL `64/72`, Display L `48/56`, H1 `40/48`, H2 `32/40`, H3 `24/32`, Body `16/24`, Small `14/20`, Micro `12/16`.
- Weights: 400, 500, 600, 700/800.

---

## 🗂️ Folder structure (from §4.3 of the design pack)

The bootstrap skill creates this exactly:

```
src/
├── assets/
│   ├── logo/
│   ├── textures/
│   └── examples/
├── components/
│   ├── ui/                    # AppButton, AppInput, AppModal, AppToast, AppCard, AppStepper
│   ├── layout/                # AppHeader, AppShell, DashboardShell
│   ├── upload/                # UploadDropzone, FilePreview
│   ├── editor/                # StickerEditor, EditorToolbar, CanvasStage, InspectorPanel,
│   │                           # CutOverlay, ZoomControls, ProcessingOverlay
│   │                           # (ReliefOverlay deferred — no drawn relief mask in MVP)
│   ├── order/                 # MaterialSelector, SizeInput (width_mm + height_mm),
│   │                           # QuantityStepper, AddOnsToggle (relief, varnish, design service),
│   │                           # ReliefNoteField, OrderSummary
│   └── admin/                 # (post-MVP — Django admin covers M2 ops)
├── composables/               # useAuth, useUpload, useOpenCV, useStickerCanvas,
│                              # useCutDetection, useOrders, usePriceQuote
│                              # (useReliefMask deferred)
├── stores/                    # auth.store, order.store, ui.store
│                              # (sticker.store merged into order — drafts ARE orders)
├── views/                     # 12 view files matching routes
├── services/                  # api, auth.service, orders.service, files.service
├── types/                     # auth, order, api
├── router/
│   └── index.ts
└── styles/
    ├── tokens.css
    └── globals.css
```

Architecture rules (non-negotiable):

- **UI components are reusable and dumb.** They take props, emit events, don't talk to stores or services.
- **Composables hold business logic.** `useStickerCanvas`, `useCutDetection`, etc.
- **Stores hold app state.** Reactive, persisted where appropriate.
- **Services hold API calls.** Single source of truth for `/api/*` endpoints.
- **Views are thin.** Compose components, wire stores → composables → user. No fetch calls in `<script setup>` of a view file.

---

## ⚠️ Critical recipes (gotchas already paid for)

### OpenCV.js memory management

OpenCV `Mat`, `MatVector`, and contour objects are **manually managed** — they aren't garbage-collected by JavaScript. Every `.delete()` you skip is a memory leak that will crash the tab on a long editing session.

**Rule**: every `cv.imread()`, `new cv.Mat()`, `new cv.MatVector()` MUST be paired with a `.delete()` in a `finally` block. The `useCutDetection` composable should wrap the algorithm so call sites can't forget.

### OpenCV.js readiness

OpenCV.js loads asynchronously from CDN. **Don't call any `cv.*` function before `cv.onRuntimeInitialized` fires**. The `useOpenCV` composable owns this — components should `await waitForOpenCV()` before invoking detection.

The CDN script tag goes in `index.html`:
```html
<script async src="https://docs.opencv.org/4.x/opencv.js"></script>
```

### Layered canvas architecture

The editor uses **4 separate canvas elements** stacked on top of each other:

1. **Base canvas** — the original uploaded image
2. **Cut overlay canvas** — the detected contour line
3. **Relief drawing canvas** — what the user paints
4. **Interaction layer** — captures mouse/touch events

Why: easier to export each layer separately (cut mask, relief mask), easier to toggle overlays, better performance than redrawing one giant canvas on every brush stroke.

### Image size policy

**Don't process huge images at full size.** A 25 MB PNG will freeze the tab during edge detection.

**Rule**: `useStickerCanvas` keeps the original `File` for the production upload (server gets the high-res original) but creates an optimized preview canvas (max 2048×2048) for editing. OpenCV runs against the preview; the cut mask is exported at preview resolution. Backend rescales to original dimensions if needed.

### Async states are explicit

Every async action exposes one of: `'idle' | 'loading' | 'success' | 'error'`. Pattern:

```ts
const status = ref<AsyncStatus>('idle')
const error = ref<string | null>(null)
async function run() {
  status.value = 'loading'
  try { await action(); status.value = 'success' }
  catch (e) { error.value = String(e); status.value = 'error' }
}
```

UI must reflect every state distinctly. The PDF specifies overlay states for the editor (scanner overlay during processing, glow + message after detection, etc.) — implement those.

### Backend authentication (Django)

The Django backend issues JWT tokens via `dj-rest-auth`. Frontend pattern:

- `POST /api/v1/auth/login/` returns `{ access, refresh }` (or `access_token`/`refresh_token` depending on dj-rest-auth version — handle both: `r.data.access ?? r.data.access_token`)
- Store both tokens; default `axios` `Authorization: Bearer <access>`
- On 401: try `POST /api/v1/auth/token/refresh/` with the refresh token; on refresh failure, force re-login
- Logout: `POST /api/v1/auth/logout/` + clear local storage

The `useAuth` composable owns this; views never touch tokens directly.

### Customer registration creates inactive users

Per the backend's contract: registration creates `is_active=False, is_verified=False`. The customer receives an email with a setup link → they hit the frontend's `/set-password?token=...&email=...` page → frontend POSTs to `POST /api/v1/users/set-password/` → backend activates the account **and creates the allauth `EmailAddress` row** (without that row, login silently fails — the backend handles this; the frontend just needs to follow the flow).

Frontend handles this via:
- `RegisterView` → call `POST /api/v1/auth/register/` → show "revisá tu email" message (do NOT auto-login). The backend always returns 200 even for already-registered emails (don't leak account existence) — the UI message must be the same in both cases.
- `/set-password` route → `SetPasswordView` reads token + email from query string → POSTs to `/api/v1/users/set-password/` → on success, redirects to `/login`

**Gotcha**: the user can't log in until they've completed set-password. Don't try to log them in immediately after register.

### Forgot-password flow

Backend M2 ships a working forgot-password flow via dj-rest-auth + allauth. The reset link emailed to the customer points at the frontend (`{FRONTEND_URL}/reset-password?uid=...&token=...`). The frontend needs:

- A `/reset-password` route → `ResetPasswordView` reads `uid` + `token` from query string, shows a "new password" form, POSTs to `POST /api/v1/auth/password/reset/confirm/` with `{ uid, token, new_password1, new_password2 }`. On success → redirect to `/login` with a "password updated" toast.
- A "forgot password?" link on the login page → opens a modal or `/forgot-password` route → POSTs `{ email }` to `POST /api/v1/auth/password/reset/` → shows "check your email" message regardless of whether the email exists (no leak).

### Stripe checkout (frontend side)

After `POST /api/v1/orders/{uuid}/checkout/` returns `{ client_secret, payment_intent_id, amount_cents, currency }`:

1. Mount Stripe Elements (`<PaymentElement>`) bound to the `client_secret`. **Don't show the form before the secret arrives — race condition.**
2. On submit, call `stripe.confirmPayment({ elements, confirmParams: { return_url: ... } })`. Some payment methods redirect (3DS, iDEAL, Bizum, etc.); pass a `return_url` that resolves to the order detail page on this frontend.
3. The backend webhook flips the order to `paid` asynchronously when Stripe confirms. The frontend should POLL `GET /api/v1/orders/{uuid}/` for ~5–15 seconds after `confirmPayment` resolves and update the UI when status flips. Or just redirect to the order detail page and let it refresh.
4. The `STRIPE_PUBLISHABLE_KEY` is configured server-side; expose it to the frontend via a small endpoint or via a build-time env var (`VITE_STRIPE_PUBLISHABLE_KEY`). Test cards: `4242 4242 4242 4242` succeeds, `4000 0027 6000 3184` requires 3DS, `4000 0000 0000 0002` declines.

**Stripe is not live yet** as of M2 — backend is wired but the shop owner's Stripe account + test keys land at deploy time. Until then, the checkout endpoint will return a real-looking `client_secret` only if dummy keys are configured; otherwise it returns 502. Plan accordingly: mock the Stripe layer in dev until the keys exist.

---

## 📡 API contract (M2 — what the backend actually ships)

The backend's URL prefix is `/api/v1/`. There is **no separate** `/api/sticker-drafts/` resource — a draft is just `Order(status="draft")`. There is no separate `/api/admin/...` resource — staff use Django admin (registered in M2) or the same `/api/v1/orders/` endpoints (the queryset is role-scoped server-side: customers see their own, staff see all).

If anything in §4.12 of the design pack contradicts this section, **this section wins** — the design pack predates the backend's M2 implementation.

### Auth (`/api/v1/auth/`)
- `POST /api/v1/auth/register/` — `{ email, password, first_name?, last_name? }` → 200. Creates inactive customer, sends verification email.
- `POST /api/v1/auth/login/` — `{ email, password }` → `{ access, refresh }` (or `access_token`/`refresh_token` depending on dj-rest-auth version; handle both)
- `POST /api/v1/auth/logout/`
- `POST /api/v1/auth/token/refresh/` — `{ refresh }`
- `POST /api/v1/auth/password/reset/` — `{ email }` → 200 (always, no leak)
- `POST /api/v1/auth/password/reset/confirm/` — `{ uid, token, new_password1, new_password2 }`

### Users (`/api/v1/users/`)
- `GET   /api/v1/users/me/` — current user profile (replaces `/api/auth/me/`)
- `POST  /api/v1/users/set-password/` — `{ email, token, password }` activates the account from the verification email link

### Orders (`/api/v1/orders/`)
- `GET    /api/v1/orders/` — paginated `{ count, results: [Order] }`. Customer sees own; staff sees all.
- `POST   /api/v1/orders/` — empty body → creates a `draft` order owned by the requesting user
- `GET    /api/v1/orders/{uuid}/` — retrieve
- `PATCH  /api/v1/orders/{uuid}/` — edit fields (material, dimensions, quantity, add-ons, shipping). **Returns 409 if status != draft.**
- `POST   /api/v1/orders/{uuid}/place/` — draft → placed. Validates required fields; computes total. Returns 409 / 400 on guard fail.
- `POST   /api/v1/orders/{uuid}/checkout/` — placed → triggers Stripe `PaymentIntent`. Returns `{ client_secret, payment_intent_id, amount_cents, currency }`. Frontend confirms the payment via Stripe.js.
- `POST   /api/v1/orders/{uuid}/cancel/` — `{ reason? }` → cancelled. **Customer-only**, only while `{draft, placed}`. (Refunds after `paid` are admin-driven via Stripe dashboard, NOT self-service in M2.)
- `POST   /api/v1/orders/{uuid}/deliver/` — shipped → delivered. **Customer-only.**
- `POST   /api/v1/orders/{uuid}/start-production/` — paid → in_production. **Staff-only.**
- `POST   /api/v1/orders/{uuid}/ship/` — in_production → shipped. **Staff-only.**

### Order files (`/api/v1/orders/{uuid}/files/`)
- `GET    /api/v1/orders/{uuid}/files/` — list files for an order
- `POST   /api/v1/orders/{uuid}/files/` — multipart upload. Form fields are exactly `kind` and `file` (no other names). `kind ∈ {"original", "die_cut_mask"}` for M2; `"relief_mask"` is reserved for when drawn-relief lands.
- `DELETE /api/v1/orders/{uuid}/files/{file_uuid}/` — delete (then re-POST to swap; `unique_together(order, kind)` enforces one-per-slot)

### Pricing preview (`/api/v1/orders/quote/`)
- `GET /api/v1/orders/quote/?material=...&width_mm=...&height_mm=...&quantity=...&with_design_service=...&with_varnish=...&with_relief=...` → `{ total_amount_cents, total_eur, currency }`. Pure function, no DB write — perfect for live updates as the customer drags a slider.

### Stripe webhook (server-only)
- `POST /api/v1/payments/webhooks/stripe/` — Stripe-only, CSRF-exempt, signature-verified. The frontend never touches this URL.

### HTTP error contract
- `400` validation
- `401` not authenticated (refresh JWT and retry, or redirect to login)
- `403` authenticated but not allowed (customer hitting a staff endpoint, or customer hitting another customer's order)
- `404` not found / not yours
- `409` conflict — wrong status for this transition (PATCH on placed, place on non-draft, cancel after paid, deliver before shipped). Render a clear "this order is no longer in a state where you can do that" message.
- `502` Stripe error during checkout (network or Stripe outage). Retry-friendly.

## 💰 Pricing model (real, locked)

`compute_total_cents()` on the backend is pure and deterministic. The frontend should never duplicate this math — always call `/orders/quote/` for the live total. But for explanation:

```
total_eur = material_base
          + (width_cm + height_cm) × 1€
          + quantity × 1€
          + (8€ if with_design_service)
          + (8€ if with_varnish)
          + (12€ if with_relief)
```

**Material base prices** (the "Elegir material" picker — gold-standard scenario `holografico, 5×5 cm, q=50` → 110€):

| Material key | Display | Base €  |
|---|---|---|
| `vinilo_blanco` | Vinilo blanco | 45 |
| `vinilo_transparente` | Vinilo transparente | 45 |
| `holografico` | Vinilo holográfico | 50 |
| `holografico_transparente` | Vinilo holográfico transparente | 50 |
| `plateado` | Vinilo plateado | 50 |
| `dorado` | Vinilo dorado | 50 |
| `luminiscente` | Vinilo luminiscente | 55 |
| `eggshell` | Vinilo eggshell | 55 |
| `eggshell_holografico` | Vinilo eggshell holográfico | 60 |

**Constraints** (frontend should validate before submitting; backend rejects with 400 on violation):
- `width_mm` and `height_mm`: multiples of 5, ≥ 25 (= 2.5 cm). Display in cm (`mm / 10`).
- `quantity`: integer, 20 ≤ q ≤ 100 000.

## 🔢 Wire format conventions

The single biggest source of frontend ↔ backend bugs in two-repo projects is field-name and type drift. The backend's contract:

- **UUIDs are named `uuid`, not `id`.** `Order.uuid`, `OrderFile.uuid`, `User.uuid`. Frontend types must mirror this.
- **Money is integer cents on the wire** (`total_amount_cents: number`). The serializer also exposes `total_eur: string` ("110.00") for display convenience. Use `total_eur` for rendering; never `total_amount_cents / 100` (float precision loss).
- **Status enums are snake_case strings**: `"draft"`, `"placed"`, `"paid"`, `"in_production"`, `"shipped"`, `"delivered"`, `"cancelled"`. Translate for display (`"En producción"`) but the wire value stays `"in_production"`.
- **`OrderFile.kind` enum**: `"original"`, `"die_cut_mask"`. Add `"relief_mask"` when the drawn-mask feature ships.
- **Multipart upload field names are exactly `file` and `kind`**. Anything else is silently dropped.

The `api-contract-check` skill (separate, installed at `~/.claude/skills/api-contract-check/`) enforces these on every change touching the boundary.

---

## 🚧 Status (project start)

### Done
- Folder created at `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endosstudio_frontend/`
- CLAUDE.md reconciled with backend M2 reality (this file)
- Bootstrap skill exists at `~/.claude/skills/bootstrap-stickerapp-frontend/`
- Four supporting skills installed: `canvas-editor-system`, `opencv-js-integration`, `api-contract-check`, `playwright-frontend-test`
- Backend at M2: 48 tests green, real pricing wired, real auth + email + reset flow shipped

### Next (in order)
1. **Run the bootstrap skill** to lay down Phase 1: Vite + TS + Tailwind + tokens.css + router + Pinia stores + base layout + UI components + Playwright config
2. **Move the design pack PDF into `docs/`** so it lives in the repo
3. **First view: `HomeView`** (the hero from the mockup) — pure styling, no backend calls; gets the brand visible fast
4. **`AuthFlow` views**: `RegisterView`, `LoginView`, `SetPasswordView`, `ResetPasswordView`. These exercise the real backend; first contract-bound code. Add Playwright spec for the full register → set-password → login → /me/ roundtrip (the M2 backend gate test mirrored client-side).
5. **Order creation flow**: upload → editor (auto-crop via OpenCV.js) → spec config → quote → place → checkout. This is where the canvas + opencv skills earn their keep.
6. **History + cancel** — small.

### Stripe is gated on deploy
The backend has the checkout endpoint wired (`POST /api/v1/orders/{uuid}/checkout/`) but it returns 502 without real Stripe keys. Mock the Stripe layer in dev (the `playwright-frontend-test` skill describes the pattern). The shop owner's Stripe account + test keys land at deploy time, not now.

### TODO (radar)
- **Auto-crop reference site URL**: the user has identified an existing shop with the exact UX they want for auto-crop. They'll share the URL when canvas/OpenCV work starts — ASK BEFORE designing that component from first principles.
- Decide hosting (Vercel / Netlify / self-hosted alongside the backend's nginx?)
- OpenCV.js version pinning (currently `4.x` from CDN — pin to a specific version once we've tested with it)
- Fonts: pick Inter vs Satoshi vs Manrope — design pack says "or similar"
- Email backend in production: backend uses the SMTP env vars (`EMAIL_HOST`, `EMAIL_HOST_USER`, ...) — confirm Gmail SMTP / SES / Mailgun before deploy

---

## 🔗 Reference: backend codebase

`/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/` (https://github.com/sebastiangolijow/EnDosStudioApp)

The Django backend is a sibling project. Its `CLAUDE.md` is the source of truth for: API surface, auth flow (allauth EmailAddress trap, JWT), file-upload model, real pricing constants, the gold-standard scenario (`holografico, 5×5 cm, q=50` → 110€).

When in doubt about an endpoint shape, **read the backend's serializer file**, not the design pack — the M2 implementation is what's real. The relevant files:

- `apps/orders/serializers.py` — `OrderSerializer`, `OrderFileSerializer`, `PriceQuoteSerializer`, `CheckoutResponseSerializer`
- `apps/orders/views.py` — `OrderViewSet`, `OrderFileViewSet`, `PriceQuoteView`
- `apps/orders/services.py` — pricing constants, transition guards
- `apps/orders/models.py` — Order, OrderFile, status/material choices, dimension/quantity bounds
- `apps/users/views.py` — `RegisterView`, `SetPasswordView`, `CurrentUserView`
- `apps/users/auth_urls.py` — full auth URL set
- `apps/payments/views.py` — `StripeWebhookView` (frontend doesn't touch this)

---

## 📂 Files / paths to know

- **Design pack (source of truth for visuals + brand)**: `/Users/cevichesmac/Downloads/Stickerapp Frontend Design Pack.pdf` (move into `docs/` at first scaffold). Where the design pack disagrees with this CLAUDE.md or the backend's M2 implementation, **the backend wins on API/data contracts** and **the design pack wins on visuals**.
- **Sibling backend project**: `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/`
- **YeKo Studio context**: `/Users/cevichesmac/Desktop/yeko_studio/yeko_studio_context.md`
- **Bootstrap skill**: `~/.claude/skills/bootstrap-stickerapp-frontend/`
- **Supporting skills**: `~/.claude/skills/canvas-editor-system/`, `~/.claude/skills/opencv-js-integration/`, `~/.claude/skills/api-contract-check/`, `~/.claude/skills/playwright-frontend-test/`
- **Mockup image** (optional reference): the screenshot the user provided in the bootstrap session — captures landing + editor + upload + material selector + dashboard layouts in one frame

---

*Index file. Edit when conventions change or new gotchas surface. Keep it short — push detail into per-component docs as the codebase grows.*
