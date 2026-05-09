# StickerApp Frontend — AI Context

> **Studio**: YeKo Studio · **Client**: Barcelona print shop selling custom stickers
> **Stack**: Vue 3 · Vite · TypeScript · Vue Router · Pinia · Tailwind CSS · Axios · Canvas API · OpenCV.js (CDN)
> **Backend**: separate Django + DRF project at `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/` (https://github.com/sebastiangolijow/EnDosStudioApp)
> **Status**: feature-complete for the MVP customer flow as of session 2026-05-03 + repricing 2026-05-09 + catalog M3a 2026-05-09. SPA shipped end-to-end (auth, upload, editor with auto-crop + materials + Forma + halo, order-config, checkout stub, catalog browse/buy, admin product CRUD). 50/50 functional Playwright specs passing. Editor matches the reference shop's UX (vivid material halo in bleed margin, transparent vinyl preview, geometric shapes pass through editor, background removal). Stripe live keys + email SMTP + first deploy are the operational blockers, not code.

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

## 🗂️ Folder structure (current, as of 2026-05-03)

```
src/
├── assets/
│   ├── logo/                  # logo
│   ├── examples/              # marketing imagery
│   └── textures/              # MATERIAL TEXTURES — bundled PNGs, 512×512:
│                              # holografico, holografico_transparente,
│                              # dorado, plateado, eggshell, eggshell_holografico,
│                              # vinilo_blanco, luminiscente
│                              # (vinilo_transparente has no PNG by design — see below)
├── components/
│   ├── ui/                    # AppButton, AppInput, AppCard, AppModal, AppToast, AppStepper
│   ├── layout/                # AppHeader, AppShell, DashboardShell
│   ├── upload/                # UploadDropzone, FilePreview
│   ├── editor/
│   │   ├── CanvasStage.vue    # 3-layer stack: mask → base → ui (DOM order = visual order)
│   │   ├── EditorToolbar.vue  # Auto cut + 4 stub buttons; Auto cut disabled for non-contorneado
│   │   └── EditorInspector.vue # right rail: Forma + Material + Relieve + Vista
│   │                          # + Margen slider + Detección sliders
│   └── order/                 # MaterialCard, ShapeCard, SizePicker, QuantityStepper,
│                              # OrderSummary, ShippingForm, OrderHistoryCard
├── composables/
│   ├── useAutoCropWorker.ts   # singleton Web Worker + request-id-keyed promise map
│   ├── useCanvasEditor.ts     # 3-layer canvas, fit transform, mask/halo/clip state
│   ├── useAutoCrop.ts         # legacy main-thread; kept on disk, not imported
│   ├── useOpenCV.ts           # legacy CDN-script gate; kept for reference
│   ├── useAuth.ts
│   └── useToast.ts
├── workers/
│   └── autoCrop.worker.ts     # classic worker; importScripts(opencv.js);
│                              # alpha → bg-trim → canny strategies; emits
│                              # { points, areaPx, artworkPoints? }
├── utils/
│   └── materialColors.ts      # MATERIAL_TEXTURE_URLS + textureFill factory +
│                              # per-material MaskPalette (fill + stroke)
├── stores/                    # auth.store, order.store, ui.store
│                              # (sticker store merged into order — drafts ARE orders)
├── views/                     # 14 views, one per route
├── services/                  # api (axios + JWT refresh), auth/orders/files services
├── types/
│   └── order.ts               # Order, OrderUpdatePayload, Material + MATERIAL_LABELS,
│                              # Shape + SHAPE_LABELS, OrderFileKind, dimension/qty bounds
├── router/
│   └── index.ts               # 14 routes with auth/admin meta
└── styles/
    ├── tokens.css
    └── globals.css
```

Architecture rules (non-negotiable):

- **UI components are reusable and dumb.** They take props, emit events, don't talk to stores or services.
- **Composables hold business logic.** `useCanvasEditor`, `useAutoCropWorker`, etc.
- **Stores hold app state.** Reactive, persisted where appropriate.
- **Services hold API calls.** Single source of truth for `/api/*` endpoints.
- **Views are thin.** Compose components, wire stores → composables → user. No fetch calls in `<script setup>` of a view file.
- **Single source of truth for material visuals**: `src/utils/materialColors.ts`. The order-config MaterialCard swatches AND the editor inspector swatches AND the canvas halo all read from it. If you tweak a material's appearance, do it there.

---

## ⚠️ Critical recipes (gotchas already paid for)

### OpenCV.js runs in a Web Worker

OpenCV.js is ~10 MB of WASM. Compiling it on the main thread blocks
the page long enough that Chrome trips the "Page Unresponsive"
dialog. So:

- `src/workers/autoCrop.worker.ts` owns its own OpenCV runtime via
  `importScripts(opencv.js)` (classic worker, not module — module
  workers don't support `importScripts`).
- The worker runs the detection pipeline + dilation + contour
  extraction. Main thread only sends `ImageData` and receives
  `{ points, areaPx, artworkPoints? }`.
- `src/composables/useAutoCropWorker.ts` is the module-scoped
  singleton wrapper. It maps requestIds to pending promises and
  exposes the same API shape as the legacy main-thread useAutoCrop.

OpenCV.js is NOT loaded from `index.html`. It's loaded only when the
editor route opens, by the worker. Other pages don't pay the cost.

### OpenCV memory management (still applies inside the worker)

`Mat`, `MatVector`, contour objects are manually managed. Every
allocation in `autoCrop.worker.ts` is paired with a `.delete()` in
a `finally` block. The worker context is long-lived; leaks would
accumulate across runs.

### Three-strategy auto-crop

The worker picks a detection strategy based on what's actually in the
image (smarter than vanilla Canny):

| Strategy | Trigger | Pipeline |
|---|---|---|
| `alpha` | any pixel α<250 | threshold alpha at 128 |
| `bg-trim` | opaque + perimeter stddev < 35 | sample bg color, inRange + invert + close |
| `canny` | both above failed | Canny → findContours → max-area |

Each strategy unions all real contours (filtered by min area) into a
filled mask, which then goes through dilation for the bleed margin
and `approxPolyDP` for smoothing. Strategy chosen is logged via
`console.info("[autocrop] strategy=...")` for browser-console debugging.

### 3-layer canvas architecture (with mask BELOW base)

The editor stacks 3 canvases:

1. **Mask layer** (DOM index 0, lowest) — die-cut polygon halo
2. **Base layer** (DOM index 1) — the customer's image, optionally
   clipped to a polygon
3. **UI layer** (DOM index 2, top) — receives all pointer events

The mask layer is *below* the base by design. With a tight artwork
polygon clipping the base, the halo shows only in the bleed margin
(where there's no artwork to cover it). Reorder this and the halo
disappears entirely.

### Tight clip + bleed clip

The worker returns TWO polygons:
- `points` — the cut polygon (artwork + bleed margin)
- `artworkPoints` — the tight artwork silhouette (no bleed)

`useCanvasEditor.setMask(points, artworkPoints?)` stores both. The
clip used for `removeBackground` prefers the tight one — that lets
the halo show in the bleed margin without the photo's background
covering it. Geometric shapes (cuadrado/circulo/redondeadas) don't
supply `artworkPoints` (the polygon IS the silhouette there) and the
clip falls back to the cut polygon.

### Material textures vs. transparent vinyl

8 of 9 materials use real PNG textures bundled in `src/assets/textures/`.
`vinilo_transparente` is the exception — there's no PNG. Picking it
sets `transparentMaterial=true`, which drops the base image's
`globalAlpha` to 0.55 so the canvas's checker pattern reads through
the artwork. Matches the reference shop's "transparent vinyl" preview
exactly. Don't add a transparent PNG; the layer trick is the design.

### Image size policy

OpenCV runs against a **working-size** copy capped at 1024 px on the
long edge (see `useAutoCropWorker.imageToWorkingImageData`). Polygon
coordinates returned by the worker are scaled back to image-natural
pixels. The original `File` is what gets uploaded to the backend —
the working-size canvas is editor-only.

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
- `GET /api/v1/orders/quote/?material=...&width_mm=...&height_mm=...&quantity=...&with_relief=...&with_tinta_blanca=...&with_barniz_brillo=...&with_barniz_opaco=...` → `{ total_amount_cents, total_eur, currency }`. Pure function, no DB write — perfect for live updates as the customer drags a slider.

### Stripe webhook (server-only)
- `POST /api/v1/payments/webhooks/stripe/` — Stripe-only, CSRF-exempt, signature-verified. The frontend never touches this URL.

### HTTP error contract
- `400` validation
- `401` not authenticated (refresh JWT and retry, or redirect to login)
- `403` authenticated but not allowed (customer hitting a staff endpoint, or customer hitting another customer's order)
- `404` not found / not yours
- `409` conflict — wrong status for this transition (PATCH on placed, place on non-draft, cancel after paid, deliver before shipped). Render a clear "this order is no longer in a state where you can do that" message.
- `502` Stripe error during checkout (network or Stripe outage). Retry-friendly.

## 💰 Pricing model (real, locked — repriced 2026-05-09)

`compute_total_cents()` on the backend is pure and deterministic. The
frontend should never duplicate this math — always call `/orders/quote/`
for the live total. But for explanation:

```
area_factor      = ((width_mm + 15) / 1000) × ((height_mm + 15) / 1000)
                   # area in m², including a 15 mm bleed margin per side
subtotal_eur     = area_factor × quantity × material_price_eur
addon_multiplier = 1
                 + (0.35 if with_relief)
                 + (0.35 if with_tinta_blanca)
                 + (0.20 if with_barniz_brillo)
                 + (0.20 if with_barniz_opaco)
total_eur        = max(subtotal_eur × addon_multiplier, 20.00)
```

Add-on surcharges compose **additively** (sum the percents, then
multiply once). The 20€ minimum applies AFTER add-ons — small orders
floor regardless of which add-ons are ticked.

**Material prices** (the "Elegir material" picker; rate is "€ per m² per
sticker" plugged into the formula above):

| Material key | Display | Rate €  |
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

**Gold-standard scenarios** (kept in the test suite as regressions):
- `vinilo_blanco 10×10cm q=100, no add-ons` → **59.51€** (above floor)
- `holografico 5×5cm q=50, no add-ons` → **20.00€** (floor case)
- `vinilo_blanco 10×10cm q=100 +relief +brillo` → **92.24€** (multiplier 1.55)

**Add-on UX**: Relieve and Tinta blanca are independent checkboxes.
Barniz is a single radio group with three options (`none` / `brillo` /
`opaco`) — gloss and matte are mutually exclusive in the UI but ride two
booleans on the wire (`with_barniz_brillo`, `with_barniz_opaco`) so the
backend formula stays a clean sum-of-percentages.

**Constraints** (frontend should validate before submitting; backend rejects with 400 on violation):
- `width_mm` and `height_mm`: multiples of 5, ≥ 25 (= 2.5 cm). Display in cm (`mm / 10`).
- `quantity`: integer, 20 ≤ q ≤ 100 000.

## 🔢 Wire format conventions

The single biggest source of frontend ↔ backend bugs in two-repo projects is field-name and type drift. The backend's contract:

- **UUIDs are named `uuid`, not `id`.** `Order.uuid`, `OrderFile.uuid`, `User.uuid`. Frontend types must mirror this.
- **Money is integer cents on the wire** (`total_amount_cents: number`). The serializer also exposes `total_eur: string` ("110.00") for display convenience. Use `total_eur` for rendering; never `total_amount_cents / 100` (float precision loss).
- **Status enums are snake_case strings**: `"draft"`, `"placed"`, `"paid"`, `"in_production"`, `"shipped"`, `"delivered"`, `"cancelled"`. Translate for display (`"En producción"`) but the wire value stays `"in_production"`.
- **`Order.kind`** (M3a) discriminates `"sticker"` (M2 default) vs `"catalog"` (new). Catalog orders carry `product` (UUID) + `product_quantity` instead of sticker spec fields. The serializer also returns nested `product_detail` (`name`, `slug`, `image`, `price_cents`, `price_eur`) so the frontend renders the catalog summary without a second fetch. Branch on `order.kind` everywhere kind-specific UI is needed: CheckoutView, ConfirmationView, DashboardView's OrderHistoryCard, AdminOrderDetailView. Sticker views (UploadView, EditorView, OrderConfigView) are sticker-only by definition — catalog orders skip them entirely.
- **`OrderFile.kind` enum**: `"original"`, `"die_cut_mask"`. Add `"relief_mask"` when the drawn-mask feature ships.
- **Multipart upload field names are exactly `file` and `kind`**. Anything else is silently dropped.

The `api-contract-check` skill (separate, installed at `~/.claude/skills/api-contract-check/`) enforces these on every change touching the boundary.

---

## 🚧 Status

### Done — through 2026-05-03

**Bootstrap + auth + history**:
- Vue 3 + Vite + TS + Tailwind + Pinia + Router + Axios scaffold
- `HomeView` with hero
- `RegisterView` / `LoginView` / `SetPasswordView` / `ForgotPasswordView` /
  `ResetPasswordView` — all wired to the real backend
- `DashboardView` — order history with status filters
- Playwright auth roundtrip spec (mirror of the backend's M2 gate test)

**Customer flow** (upload → editor → config → checkout):
- `UploadView` — dropzone, file preview, draft creation, routes to /editor
- `EditorView` — orchestrator. Hydrates Order, persists material/shape/relief
  via debounced PATCH, manages canvas state.
- `OrderConfigView` — material grid + Forma cards + size picker + quantity +
  add-ons + live quote + "Volver al editor" CTA
- `CheckoutView` — shipping form + place_order + Stripe handoff stub
- `ConfirmationView` — order summary

**Editor (the bulk of session 2026-05-03)**:
- OpenCV.js auto-crop runs in a Web Worker
- Three detection strategies: alpha → bg-trim → Canny
- 15 mm bleed margin via dilation, capped + iterated kernel for speed
- 9 materials with real PNG textures (vinilo_transparente uses the
  layer-alpha trick)
- Material halo paints in the bleed margin only (mask-below-base + tight
  artwork clip via `artworkPoints`)
- Forma step (contorneado / cuadrado / circulo / redondeadas); geometric
  shapes get a primitive polygon at the image bbox + margin
- "Quitar fondo" toggle clips the base to the polygon
- Auto cut button disabled for non-contorneado (no point auto-detecting
  a primitive shape)
- Inspector compact picker mirrors the order-config grid

**Tests**: **30/30 functional Playwright specs passing**.

Frozen detail of the 2026-05-03 session:
`docs/archive/SESSION_2026_05_03_editor.md`.

### Next (operational, not code)

1. **Real Stripe keys**. The checkout endpoint returns 502 without
   them; the frontend's CheckoutView currently stubs the handoff. Once
   keys land, swap the stub for the real `<PaymentElement>` mount.
2. **Email backend** for `RegisterView` + `ResetPasswordView`. Backend
   uses SMTP env vars; no real provider configured yet.
3. **First deploy**. Hosting choice (Vercel / Netlify / self-hosted),
   domain, TLS. CheckoutView's `return_url` for Stripe redirects needs
   to point at the deployed origin.

### Done (Session 2026-05-09 — catalog M3a)

The frontend mirror of the backend's M3a. Catalog products are non-sticker
SKUs (llaveros etc.) bought as separate Orders with `kind="catalog"` —
mixed cart deferred to M3b.

**New routes** (in `src/router/index.ts`):
- Public: `/catalogo` (grid), `/catalogo/:slug` (detail).
- Staff (`requiresStaff` guard, admin OR shop_staff):
  `/admin/products`, `/admin/products/new`, `/admin/products/:slug/edit`.

**New views**:
- `CatalogView.vue` — grid of `ProductCard`s, public, anonymous-OK.
- `CatalogDetailView.vue` — public detail with qty stepper, anon-Comprar
  redirects to `/login?next=...`, "Sin stock" badge at qty=0, disables
  Comprar.
- `AdminProductsView.vue` — staff table with inline `is_active` toggle +
  edit links + "+ Nuevo producto".
- `AdminProductFormView.vue` — dual-mode (create/edit by route param)
  with image upload + preview. Slug is read-only (auto-generated
  server-side).

**New components**:
- `ProductCard.vue` (catalog grid item, with out-of-stock badge).
- `CatalogOrderSummary.vue` (right-rail summary for catalog orders;
  used in CheckoutView and is the kind-aware counterpart of the
  existing sticker `OrderSummary`).

**Modified views**:
- `CheckoutView.vue` — branches on `order.kind`. Catalog renders
  `CatalogOrderSummary`; sticker renders the existing `OrderSummary`.
  Stepper differs by kind (catalog: 3 steps, sticker: 4). 409 with
  `detail=insufficient_stock` triggers a Spanish toast and routes the
  customer back to the product detail. PATCH+place_order are skipped
  if the order is already placed (race-safe revisit).
- `ConfirmationView.vue` — kind-aware product/material display, "Seguir
  comprando" CTA for catalog orders (vs "Crear otro pedido" for sticker).
- `OrderHistoryCard.vue` — catalog orders show product name + qty +
  product image; sticker unchanged.
- `HomeView.vue` — added "Ver catálogo" CTA in the hero.

**New service**: `src/services/products.service.ts` (public list/get +
admin CRUD with multipart image upload). `orders.service.ts` got a
`createCatalogOrder({product, product_quantity})` method.

**New types**: `src/types/product.ts` (`Product`, `ProductRef`,
`ProductWritePayload`). `src/types/order.ts` extended with
`OrderKind`, `Order.product/product_quantity/product_detail`,
`CreateCatalogOrderPayload`. Sticker spec fields stay required in TS
to keep the M2 surface untouched (catalog orders just have empty
defaults at those fields, which is what the backend returns).

**Backend response shape note**: `ProductViewSet.create` and `update`
override the default to return `ProductSerializer.data` (not
`ProductWriteSerializer.data`) so the frontend always receives the full
read shape (uuid + slug + price_eur) from write requests. Matters because
`AdminProductsView` splices the response in place; without uuid+slug the
slot's data-testid bindings would go stale.

**5 new Playwright specs**: `catalog-public-browse`, `catalog-buy-flow`,
`catalog-admin-create`, `catalog-admin-edit`, `catalog-stock-409`.
Helpers in `tests/e2e/helpers/backend.ts` got `seedProduct` and
`seedShopStaff`.

**50/50 Playwright specs passing.**

### Open follow-ups (non-blocking)

- **Cut path SVG download from admin** — backend generates one at
  `transition_to_paid`; could surface a download link on the
  Dashboard's order detail. M3 nice-to-have.
- **More materials** — if the shop adds finishes (e.g. matte vinyl,
  textured), add the texture PNG to `src/assets/textures/` and one
  entry to `MATERIAL_TEXTURE_URLS`. ~5 LOC per material.
- **`useAutoCrop.ts` (legacy main-thread)** still on disk but no
  longer imported. Keep for ~1 release in case the worker has a regression we
  need to diff against, then delete.
- **Smoke test for the new editor flow** — was tripping on the 200×200
  test fixture (polygon at default margin already filled the canvas).
  A larger fixture or a bbox-based assertion would solve it; not
  blocking since the per-feature tests cover the components individually.

### TODO (radar)

- Decide hosting (Vercel / Netlify / self-hosted alongside the backend's nginx?)
- OpenCV.js version pinning (currently `4.x` from the worker's importScripts — pin once we've tested with it)
- Fonts: Inter is locked. Confirm font loading strategy (`@fontsource/inter` vs CDN) for prod.
- Email backend in production (Gmail SMTP / SES / Mailgun)

---

## 🧭 Decision log

Open questions where there's a working recommendation but no locked
choice yet. Update each entry to **Decided (YYYY-MM-DD): X** when the
call is made; until then it's an open question with the tradeoffs on
record so we don't relitigate from scratch next time.

> The backend has its own decision log at `endossutdio_backend/CLAUDE.md`
> for its share (email provider, hosting target, Stripe account owner,
> webhook secret rotation, media storage). This section covers the
> frontend-specific calls.

### Frontend hosting target

- **Status**: open. Coupled with the backend's hosting decision but
  separable.
- **Recommendation**: **Vercel or Netlify** for the SPA. Free tier
  covers us. Auto-deploy from GitHub + preview URLs per PR.
  Alternative: serve from the backend's nginx as a single origin.
- **Tradeoffs**:
  - *Vercel/Netlify*: zero ops, automatic TLS, preview deploys,
    excellent DX. Two origins → CORS config + cookie domain
    considerations. Free tier limits (Vercel bandwidth: 100 GB/mo)
    are far above what an SMB needs.
  - *Self-host behind backend nginx*: one origin, no CORS, simpler
    cookie story. Loses preview URLs. nginx needs SPA fallback
    (`try_files $uri $uri/ /index.html`).
- **Trigger to decide**: when the deploy task starts.

### Font loading strategy

- **Status**: open. Inter is locked as the primary font (CLAUDE.md
  Typography section). Loading mechanism not chosen.
- **Recommendation**: **`@fontsource/inter`** as a dev dep, imported
  into `main.ts`. Self-hosted via Vite's asset pipeline (no external
  request blocking first paint), versioned with `package-lock.json`.
- **Tradeoffs**:
  - *@fontsource*: locked version, no third-party request, slightly
    bigger bundle (~80 KB for the weights we use). Best for
    consistency + privacy (no Google Fonts CDN tracking).
  - *Google Fonts CDN*: smaller bundle, browsers may have it cached
    from another site. Adds an external request on first paint.
  - *Self-hosted from `assets/fonts/`*: full control, zero deps,
    requires manually subsetting + format choices.
- **Trigger to decide**: before first deploy. The dev experience
  works fine with system fonts until then.

### OpenCV.js version pinning

- **Status**: open. Worker calls `importScripts('https://docs.opencv.org/4.x/opencv.js')`
  — the `4.x` URL points to whatever the latest 4.x build is.
- **Recommendation**: pin to a specific build (e.g.
  `https://docs.opencv.org/4.10.0/opencv.js`) once we've verified
  the editor still passes the 30 functional specs against it. The
  current `4.x` tag is convenient for development but a CDN update
  could silently break us on a Saturday night.
- **Trigger to decide**: before first deploy. Or sooner if the test
  suite ever flakes on auto-crop without a code change.

### Stripe-checkout polling vs. redirect

- **Status**: open. CLAUDE.md describes both patterns; we haven't
  picked one for `CheckoutView`.
- **Recommendation**: **redirect to `/confirmation/{uuid}` with a
  small poll on that view**. The polling code only lives on one
  page; CheckoutView stays simple and dumb. Confirmation polls
  `GET /api/v1/orders/{uuid}/` for ~5–15 seconds until status flips
  to `paid`, then renders the success state. If the webhook hasn't
  fired by then, surface a "we're confirming your payment, refresh
  in a minute" state — never block the customer.
- **Tradeoffs**:
  - *Redirect + poll on confirmation*: clean separation. Survives
    Stripe redirects (3DS, iDEAL, Bizum). Customer leaves checkout.
  - *Stay on checkout + poll there*: customer never leaves the
    payment screen. But Stripe's redirect-based payment methods
    break this entirely.
- **Trigger to decide**: when real Stripe keys land and we can test
  the actual confirm-payment path end-to-end.

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

- **Design pack (source of truth for visuals + brand)**: `docs/design-pack.pdf` (already in repo). Where the design pack disagrees with this CLAUDE.md or the backend's implementation, **the backend wins on API/data contracts** and **the design pack wins on visuals**.
- **Mockups**: `docs/mockups.jpeg` — the six-screen composite the user supplied at scaffold time.
- **Past-session briefings (archive)**: `docs/archive/SESSION_START.md` (bootstrap), `docs/archive/SESSION_2026_05_03_editor.md` (editor + Forma + materials). Read for historical context only — current state lives in this file.
- **Sibling backend project**: `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/`
- **YeKo Studio context**: `/Users/cevichesmac/Desktop/yeko_studio/yeko_studio_context.md`
- **Bootstrap skill**: `~/.claude/skills/bootstrap-stickerapp-frontend/`
- **Supporting skills**: `~/.claude/skills/canvas-editor-system/`, `~/.claude/skills/opencv-js-integration/`, `~/.claude/skills/api-contract-check/`, `~/.claude/skills/playwright-frontend-test/`
- **Mockup image** (optional reference): the screenshot the user provided in the bootstrap session — captures landing + editor + upload + material selector + dashboard layouts in one frame

---

*Index file. Edit when conventions change or new gotchas surface. Keep it short — push detail into per-component docs as the codebase grows.*
