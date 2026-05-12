# StickerApp Frontend — AI Context

> **Studio**: YeKo Studio · **Client**: Barcelona print shop selling custom stickers
> **Stack**: Vue 3 · Vite · TypeScript · Vue Router · Pinia · Tailwind CSS · Axios · Canvas API · WebGL (FX layer) · OpenCV.js (CDN)
> **Backend**: separate Django + DRF project at `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/` (https://github.com/sebastiangolijow/EnDosStudioApp)
> **Status (EOD 2026-05-12)**: MVP customer flow complete + IVA 21% pricing + shipping methods + phone/email shipping contact + discount codes + reservations (in-store pickup whitelist) + admin command center (status dropdown + shipped popup with carrier emails + bulk product management + user whitelist + discount CRUD) + premium materials (6 FX modes: holografico, holografico_transparente, eggshell_holografico, luminiscente, plateado/silver, dorado/gold) + drag-to-move geometric shapes including the new Óvalo + negative margins for geometric crops + email workflows (customer received + owner notified + customer shipping tracking). 72+ functional Playwright specs passing. Stripe live keys + production SMTP + first deploy remain the operational blockers, not code.

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

## 🗂️ Folder structure (current, as of 2026-05-12)

```
src/
├── assets/
│   ├── logo/                  # logo
│   ├── examples/              # marketing imagery
│   └── textures/              # MATERIAL TEXTURES:
│                              # ── halo (mask layer, bundled): holografico,
│                              #    holografico_transparente, dorado, plateado,
│                              #    eggshell, eggshell_holografico,
│                              #    vinilo_blanco, luminiscente — 512×512 PNGs
│                              # ── macro (WebGL FX layer, AI-generated):
│                              #    holografico_macro, holografico_transparente_macro,
│                              #    eggshell_holografico_macro, luminiscente_macro
│                              #    — 1024×1024 PNGs from DALL-E 3
│                              # (vinilo_transparente, plateado, dorado: no
│                              #    macro PNG — silver/gold are procedural-only)
├── components/
│   ├── ui/                    # AppButton, AppInput, AppCard, AppModal, AppToast,
│   │                          # AppStepper, AppBottomSheet, StatusBadge
│   ├── layout/                # AppHeader, AppShell, DashboardShell
│   ├── upload/                # UploadDropzone, FilePreview (used post-bootstrap;
│   │                          # main flow now lands directly in the editor)
│   ├── editor/
│   │   ├── CanvasStage.vue    # 4-layer stack: mask → base → fx (WebGL) → ui.
│   │   │                      # Forwards canvas-pointerdown so the parent can
│   │   │                      # decide whether to start a drag. Accepts a
│   │   │                      # uiCursor prop ('grab' for geometric shapes).
│   │   ├── EditorToolbar.vue  # Auto cut + Smart cut + Borrar + Zoom +
│   │   │                      # Deshacer/Rehacer
│   │   └── EditorInspector.vue # right rail: Forma + Material + Relieve +
│   │                          # Margen slider (5–30 mm contorneado,
│   │                          # −30 to 30 mm geometric) + Suavidad slider.
│   │                          # Vista block hidden by v-if=false (client req).
│   │                          # Shape buttons lock when a mask is active.
│   ├── catalog/               # ProductCard (strikethrough sale price),
│   │                          # CatalogOrderSummary
│   └── order/                 # MaterialCard, ShapeCard, SizePicker, QuantityStepper,
│                              # OrderSummary (renders Descuento line + IVA breakdown),
│                              # ShippingForm (country dropdown + phone + email),
│                              # OrderHistoryCard
├── composables/
│   ├── useAutoCropWorker.ts   # singleton Web Worker + request-id-keyed promise map
│   ├── useCanvasEditor.ts     # canvas state, fit transform, mask/halo/clip state,
│   │                          # exposes effectMode + setEffectMode for FX driving,
│   │                          # plus beginPointerDrag + pointerToImagePixels for
│   │                          # the drag-to-move shape feature.
│   ├── useHolographicFX.ts    # WebGL FX renderer. 6 modes: holographic,
│   │                          # holographic_transparent, eggshell_holographic,
│   │                          # luminescent, silver, gold. GLSL fragment shader,
│   │                          # polygon stencils at DPR, mouse-anchored shimmer,
│   │                          # macro-texture sampling with graceful no-op.
│   ├── useAutoCrop.ts         # legacy main-thread; kept on disk, not imported
│   ├── useOpenCV.ts           # legacy CDN-script gate; kept for reference
│   ├── useAuth.ts
│   └── useToast.ts
├── workers/
│   └── autoCrop.worker.ts     # classic worker; importScripts(opencv.js);
│                              # alpha → bg-trim → canny strategies; emits
│                              # { points, areaPx, artworkPoints? }
├── utils/
│   ├── materialColors.ts      # MATERIAL_TEXTURE_URLS (halo) + MATERIAL_MACRO_URLS
│   │                          # (Vite import.meta.glob; auto-discovers _macro PNGs)
│   │                          # + textureFill factory + per-material MaskPalette
│   └── polygon.ts             # smoothPolygonPerimeter (Chaikin/Gaussian iterations),
│                              # offsetPolygonOutward (legacy, not used today)
├── stores/                    # auth.store (isAdmin/isShopStaff helpers),
│                              # order.store, ui.store
├── data/
│   └── countries.ts           # ISO 3166-1 alpha-2 list, Spanish names, ES pinned
├── views/                     # AdminDiscountsView, AdminOrderDetailView,
│                              # AdminOrdersView, AdminProductFormView,
│                              # AdminProductsView, AdminUsersView, CatalogDetailView,
│                              # CatalogView, CheckoutView, ConfirmationView,
│                              # DashboardView, EditorView, ForgotPasswordView,
│                              # HomeView, LoginView, OrderConfigView, RegisterView,
│                              # ResetPasswordView, SetPasswordView
├── services/                  # api.ts (axios + JWT refresh interceptor),
│                              # auth.service, orders.service (applyDiscount /
│                              # reserve / adminSetStatus / listShippingCarriers),
│                              # products.service, users.service,
│                              # discounts.service, files.service
├── types/
│   ├── auth.ts                # User (incl. can_reserve_orders), RegisterPayload
│   │                          # (phone_number required), AuthTokens, etc.
│   ├── order.ts               # Order (incl. discount_code/_cents/_eur, pickup_at,
│   │                          # shipping_carrier/_tracking_code/_eta_date,
│   │                          # shipping_method, shipping_phone/_email),
│   │                          # OrderStatus union ('reserved' added),
│   │                          # Material + MATERIAL_LABELS,
│   │                          # Shape + SHAPE_LABELS ('oval' added),
│   │                          # ShippingMethod + SHIPPING_METHOD_LABELS,
│   │                          # OrderFileKind, dimension/qty bounds
│   ├── product.ts             # Product + CategoryRef + ProductRef (sale_price,
│   │                          # effective_price, weight_grams, category)
│   └── api.ts                 # Paginated<T>, AsyncStatus
├── router/
│   └── index.ts               # ~22 routes with requiresAuth / requiresStaff meta.
│                              # /dashboard for staff redirects to /admin/orders.
└── styles/
    ├── tokens.css
    └── globals.css

docs/
├── design-pack.pdf            # source of truth for visuals
├── mockups.jpeg               # six-screen composite from bootstrap
├── material-textures-prompts.md  # AI prompt pack for the macro PNGs
└── archive/
    ├── SESSION_START.md
    └── SESSION_2026_05_03_editor.md
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

### WebGL FX layer (holographic / luminescent materials)

The editor has a 4-layer canvas stack: mask (2D) → base (2D) → fx (WebGL)
→ ui (2D). The FX layer is a separate `<canvas>` driven by
`useHolographicFX.ts`. It paints a per-material visual treatment
(holographic shimmer, phosphorescent glow) on top of the artwork. Rules:

- **WebGL canvas is its own DOM element** — sibling of the 2D canvases,
  not a `getContext('webgl')` on the base canvas. WebGL and 2D
  contexts are mutually exclusive on a single canvas.
- **Mostly idle**: when the customer's material isn't holographic /
  luminescent, the shader fades intensity to 0 and the rAF loop
  short-circuits before drawing. Battery-friendly on mobile.
- **Polygon stencils rasterized at drawingBufferWidth/Height** (DPR-
  aware), NOT at CSS resolution. CSS resolution + LINEAR filtering
  produces a 1-2 px alpha-soft halo at the polygon edge → iridescent
  fringe leaks past the cut line. Same `smoothPolygonPerimeter` +
  Chaikin trace as the base canvas's clip path so the shapes align.
- **Standard alpha blending — no `mix-blend-mode`**. Earlier attempt
  with `screen` blend universally washed out the artwork (screen()
  can't preserve a black pixel). The shader compensates by writing
  alpha=0 over most of the artwork interior; only the sparse
  highlight regions write visible iridescence. Result: artwork stays
  100% solid; reflections appear ONLY where the simulated light
  catches the laminate.
- **Material differentiation lives in shader params** (per-material
  palette, band sharpness, hotspot focus, alpha caps). **6 modes**:
  1. `holographic` (cool foil, sharp bands)
  2. `holographic_transparent` (same palette + stronger interior alpha)
  3. `luminescent` (phosphorescent greenish-yellow, autonomous pulse,
     edge-concentrated; substrate ×1.45 and amplified hotspot/halo
     after 2026-05-12 tuning)
  4. `eggshell_holographic` (warm pastel, broad soft bands)
  5. `silver` / **plateado** (neutral metallic chrome — gray 3-stop
     palette, white ink reads as bright silver, colored ink keeps hue)
  6. `gold` / **dorado** (warm 24k metallic — saturated yellow palette
     with deep amber shadow + pale yellow peak)
  Mode dispatch in `main()` is a stacked if-ladder on `u_mode`
  (1..6); 0 = off. See `effectModeFor(material)` in `EditorView.vue`
  for the Spanish→English mapping.
- **Macro textures (AI-generated PNGs)** sampled as a multiply layer
  on top of the procedural color. Per-material strength dials in
  `useHolographicFX.ts:TEXTURE_STRENGTH_BY_MODE`. Loading is async +
  cached; if the PNG isn't bundled the shader falls back to procedural-
  only (graceful no-op). Silver and gold are procedural-only (no
  macro PNG bundled today; `loadMacroForMode` early-returns for them).
  Drop a `<material>_macro.png` in `src/assets/textures/` and Vite's
  import.meta.glob picks it up next reload — no code changes needed.

#### Silver/gold alpha gotcha (paid for already; don't redo)

`mode_silver` and `mode_gold` use luminance-inverted **density** so
white ink lets the substrate show through (read as metallic instead
of plain white). The matching **alpha** has to invert the same way:

```glsl
// WRONG — bright pixels got near-zero alpha; the foil never showed
float ink_alpha = mix(0.92, 0.18, base_brightness);
// RIGHT
float ink_alpha = mix(0.22, 0.95, base_brightness);
```

With the inverted mix, dark ink keeps the substrate to a faint sheen
contribution (0.22) and white ink lets the foil shine through fully
(0.95). The reference photos the customer sent ("Born to shine" gold,
"Thank You" silver) both behave this way physically: the foil is the
dominant surface and printed ink sits on top of it.

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
- `GET   /api/v1/users/me/` — current user profile. Includes
  `can_reserve_orders` (the whitelist flag that gates the
  "Reservar y pagar en tienda" CTA at checkout).
- `POST  /api/v1/users/set-password/` — activates from verification link
- `GET   /api/v1/users/` — **staff-only** paginated list. Supports
  `?search=` (icontains email + first_name + last_name),
  `?can_reserve_orders=true|false`, `?role=customer|shop_staff|admin`.
- `PATCH /api/v1/users/{uuid}/` — **staff-only**. Accepts only
  `{can_reserve_orders: bool}`; other fields silently drop.

### Orders (`/api/v1/orders/`)
- `GET    /api/v1/orders/` — paginated `{ count, results: [Order] }`. Customer sees own; staff sees all.
- `POST   /api/v1/orders/` — empty body → creates a `draft` order owned by the requesting user
- `GET    /api/v1/orders/{uuid}/` — retrieve
- `PATCH  /api/v1/orders/{uuid}/` — edit fields (material, dimensions, quantity, add-ons, shipping, shipping_method, shipping_phone, shipping_email). **Returns 409 if status != draft.**
- `POST   /api/v1/orders/{uuid}/place/` — draft → placed. Validates required fields; computes total (with discount + IVA). Returns 409 / 400 on guard fail.
- `POST   /api/v1/orders/{uuid}/checkout/` — placed → triggers Stripe `PaymentIntent`. Returns `{ client_secret, payment_intent_id, amount_cents, currency }`. Frontend confirms the payment via Stripe.js.
- `POST   /api/v1/orders/{uuid}/cancel/` — `{ reason? }` → cancelled. **Customer-only**, only while `{draft, placed}`.
- `POST   /api/v1/orders/{uuid}/deliver/` — shipped → delivered. **Customer-only.**
- `POST   /api/v1/orders/{uuid}/start-production/` — paid → in_production. **Staff-only.**
- `POST   /api/v1/orders/{uuid}/ship/` — in_production → shipped. **Staff-only.**
- `POST   /api/v1/orders/{uuid}/reserve/` — **customer-only, whitelist-gated**. Body `{pickup_at: ISO 8601 datetime}`. Transitions draft|placed → reserved; rejects with 400 'past' / 403 (no whitelist).
- `POST   /api/v1/orders/{uuid}/admin-set-status/` — **staff-only force-status**. Body `{status, shipping_carrier?, shipping_tracking_code?, shipping_eta_date?}`. Bypasses transition guards. When `status='shipped'` with a tracking code, fires the customer shipping notification email.
- `GET    /api/v1/orders/shipping-carriers/` — **staff-only**. Distinct carrier names from past orders. Powers the shipped-popup `<datalist>` autosuggest.
- `POST   /api/v1/orders/{uuid}/apply-discount/` — **customer-only**. Body `{code}`. Recomputes total with the discount applied. 404 'not_found' / 409 'disabled' / 409 'wrong_status'.

### Discounts (`/api/v1/discounts/`)
- **All staff-only**. Customers redeem codes via the apply-discount
  action above; they don't list or read discounts directly.
- `GET    /api/v1/discounts/` — list all
- `POST   /api/v1/discounts/` — create `{code, percent_off, is_enabled?}`. Code normalized to uppercase server-side.
- `PATCH  /api/v1/discounts/{uuid}/` — update
- `DELETE /api/v1/discounts/{uuid}/` — delete (prefer disable for audit-trail preservation; past orders that used the code keep their `Order.discount_code` text either way)

### Products (`/api/v1/products/`)
- `GET    /api/v1/products/` — public list. Accepts `?is_active=true|false` (frontend always passes `true` from the public CatalogView). Staff sees inactive products in `/admin/products` (no filter passed).
- `GET    /api/v1/products/{slug}/` — public retrieve. Same `?is_active=true` gate.
- `POST   /api/v1/products/` — **staff-only**, multipart. Accepts `category` as free text (backend dedupes by slug into the Category table).
- `PATCH  /api/v1/products/{slug}/` — **staff-only**. Returns the full read shape (uuid + slug + price_eur + sale_price_eur + effective_price_eur + category).
- `DELETE /api/v1/products/{slug}/` — **staff-only**; 409 on PROTECT FK violation (use is_active=false instead).

### Categories (`/api/v1/categories/`)
- `GET /api/v1/categories/` — public, read-only. Drives the admin product form's category autosuggest. Categories are created implicitly when an admin types a new name; no explicit create endpoint.

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

## 💰 Pricing model (real, locked — repriced 2026-05-09, IVA + shipping + discount added 2026-05-12)

`compute_total_cents()` on the backend is pure and deterministic. The
frontend should never duplicate this math — always call `/orders/quote/`
for the live total. But for explanation:

```
area_factor       = ((width_mm + 15) / 1000) × ((height_mm + 15) / 1000)
                    # area in m², including a 15 mm bleed margin per side
work_subtotal     = area_factor × quantity × material_price_eur

addon_multiplier  = 1
                  + (0.35 if with_relief)
                  + (0.35 if with_tinta_blanca)
                  + (0.20 if with_barniz_brillo)
                  + (0.20 if with_barniz_opaco)
                  + shipping_surcharge       # 0% normal / 20% express / 60% flash

pre_discount      = max(work_subtotal × addon_multiplier, 20.00)
                    # €20 minimum applies to the WORK, not the all-in price

discount          = pre_discount × discount_percent / 100
                    # 0 when no Discount code is applied to the order

pre_iva           = pre_discount − discount

total (all-in)    = pre_iva × 1.21
                    # 21% Spanish IVA on the discounted pre-IVA amount
```

Add-on + shipping surcharges compose **additively** (sum the percents,
then multiply once). The €20 minimum is on the WORK before discount —
a 50% discount on a floored order still pays €10 + IVA on €10. Catalog
orders don't have the €20 floor (each product has its own price).

The OrderSerializer exposes the breakdown:
- `subtotal_cents`  = pre-discount work amount (so the summary card
  reads "Subtotal − Descuento + IVA = Total" — what the customer sees)
- `discount_cents`  = the amount subtracted (0 when no code)
- `iva_cents`       = 21% of pre_iva
- `total_amount_cents` = the all-in figure the customer pays

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

### Pick up here tomorrow (EOD 2026-05-12)

**No open thread — session ended green.** All features pushed to `main`.
72+ Playwright specs passing (1 skipped, no failures); typecheck clean.
The remaining operational blockers (real Stripe keys, prod SMTP, first
deploy) are configuration tasks, not code.

If picking up next, three small follow-ups worth considering:
- **Macro PNG seamless-tile QC** — the four `*_macro.png` files in
  `src/assets/textures/` may show grid lines at the 2× tile boundary
  on large stickers. Not flagged by customers yet; QC by eye on a
  full-screen preview when time permits.
- **Catalog-buy-flow stock decrement** — already wired at
  `transition_to_paid`, but no Playwright spec exercises the
  paid→stock path end-to-end. Worth adding when Stripe goes live.
- **Cut-path SVG download from the admin order detail** — the file
  is generated server-side at `transition_to_paid` but the admin UI
  doesn't surface a download link today. ~10 lines.

### Done (Session 2026-05-12 — operational polish + premium materials + discounts)

This was the longest session of the project. Twelve coherent themes
shipped end-to-end (backend + frontend + Playwright):

**A. Pricing + checkout overhaul**
- **21% IVA** is now applied on top of every order. Customer-facing
  totals are Spanish B2C all-in; the OrderSerializer breaks out
  `subtotal_cents` (pre-discount work) / `iva_cents` /
  `discount_cents` / `total_amount_cents` so the summary card can
  render the math line-by-line. Reverse helpers in `services.py`:
  `subtotal_cents_of(total)` / `iva_cents_of(total)`. Gold-standard
  number: `vinilo_blanco 10×10 q=100` now totals **€72.01**.
- **Shipping method** added: `normal` (+0%), `express` (+20%),
  `flash` (+60%). Multiplicative stacking with the existing add-on
  multipliers; same `compute_total_cents` function.
- **Shipping contact fields** on Order: `shipping_phone` (required
  at place_order; pre-filled from `User.phone_number` on checkout)
  and `shipping_email` (optional, falls back to user's email).
- **Country dropdown** replaces the free-text input (full ISO 3166-1
  alpha-2 list, Spanish names, España pinned first). Source list:
  `src/data/countries.ts`.
- **Phone is required at registration** — backend `RegisterSerializer`
  rejects without `phone_number`; frontend RegisterView surfaces a
  tel input.
- **Discount codes** ship as a new feature. New `apps/discounts.Discount`
  model (code uppercase, percent_off 1–100, is_enabled). Customer
  applies via `POST /orders/{uuid}/apply-discount/` on CheckoutView;
  OrderSummary renders a "Descuento (CODE) −€X.XX" line in success
  green between Envío and IVA. Admin manages codes at
  `/admin/discounts` (table + create/edit modal + toggle + delete).
  Pricing: discount is applied **after** the €20 work floor and
  **before** IVA. place/reserve re-validate the code at submission
  time; a disabled code silently falls back to 0% (audit trail
  preserved on `discount_code`).

**B. Reservations (in-store pickup)**
- New `'reserved'` Order status between `placed` and `paid`.
  Whitelisted customers (`User.can_reserve_orders=true`) skip Stripe
  and reserve via a modal at checkout — date+time, pickup datetime
  stored as `Order.pickup_at`. Owner takes cash at pickup, then flips
  to `paid` via the admin status dropdown.
- New `/admin/users` screen lets the owner toggle the whitelist
  per-user. Same staff-only pattern as products/discounts.
- ConfirmationView branches on `status === 'reserved'`: different
  hero copy ("Pedido reservado"), pickup block with formatted date
  + "Pagás en efectivo al retirar".
- AdminOrderDetailView shows a primary-tinted "Retiro en tienda"
  block whenever `pickup_at` is set.

**C. Admin orders command center**
- Replaced the per-status transition buttons (Marcar pagado / Iniciar
  producción / etc.) with a single **status dropdown + Aplicar
  button** — admin can force ANY status from any status. Useful for
  manual corrections (re-open cancelled, mark delivered retroactively).
- Picking **"Enviado"** opens a popup that collects carrier (free
  text with `<datalist>` autosuggest from past orders), tracking
  code, and ETA date. Submitting hits
  `POST /orders/{uuid}/admin-set-status/` and the backend fires a
  shipping email to the customer with the carrier + tracking + ETA.
- **Status cards now include `Reservado`** and `Borrador` in addition
  to the existing six — so the owner sees the full inventory at a
  glance.
- Order detail screen surfaces **download links** for the customer's
  original image and the cut-line/composite preview.
- Customer phone (tel:) and email (mailto:) on the shipping panel
  for one-click contact.

**D. Email workflows (3 of 3 now wired)**
1. Customer order-received confirmation — fires from
   `transition_to_paid` (Stripe webhook) AND `reserve_order`.
   Subject branches by status; reservation body includes pickup_at
   + "en efectivo, al retirar".
2. Owner new-order notification — same trigger paths. Sends to a
   new `settings.SHOP_OWNER_EMAIL` env var (falls back to
   `DEFAULT_FROM_EMAIL`). Body includes customer name/email, total,
   kind (sticker/catalog), pickup info for reservations.
3. Customer shipping email (pre-existing) — fires from
   `admin-set-status` when status=shipped + tracking code present.

All three are synchronous send via Django's default backend; SMTP
failures are logged but never raised — losing an email can't
unwind a successful order transition.

**E. Catalog + products**
- **New product fields**: `sale_price_cents` (when set, supersedes
  `price_cents`; customer-facing card shows strikethrough + discounted
  price in primary color), `weight_grams` (captured for future
  weight-aware shipping; no UI today), `category` (FK to a new
  `Category` model; admin types free text, backend dedupes by slug).
- **Catalog UI** denser: 2/3/4/5 columns mobile→tablet→desktop→wide,
  larger gap (gap-6 / lg:gap-8), compact ProductCard padding/type.
- **Public catalog endpoint** now respects `?is_active=true` even
  for staff visitors. CatalogView + CatalogDetailView pass it so the
  shop owner sees exactly what customers see (without this, staff
  bypassed the filter and "hidden" products kept showing on
  /catalogo — confused the owner into thinking the toggle was broken).
- **Admin sees draft orders** on the admin orders board (new
  "Borrador" status card + filter pill).
- **Staff-gating**: AppHeader shows "Panel admin" → /admin/orders
  for staff (instead of "Mi cuenta" → /dashboard); router redirects
  /dashboard → /admin/orders for staff; CatalogDetailView disables
  the Comprar button for staff (helper line: "Las cuentas de
  administración no pueden comprar productos del catálogo.").
- Cleaned up **18 leaked test products + 63 orphan media dirs**
  from `/app/media/products/` and plugged the leak: the
  catalog-admin-create spec now calls `trackSeededProductSlug(slug)`
  so `afterAll` deletes the row + its media dir.

**F. Editor — premium material FX**
- New `mode_silver` (plateado) and `mode_gold` (dorado) shader
  functions in `useHolographicFX.ts`. Same "clear lacquer on opaque
  ink" architecture as the holographic modes but with neutral / warm
  metallic palettes instead of an iridescent gradient.
- **Critical fix shipped late in the session**: both modes had
  `ink_alpha` mix endpoints inverted, so white artwork pixels got
  near-zero alpha and the foil never showed through. Now bright
  pixels read as solid metallic silver / gold (matching the
  reference photos the customer sent: "Born to shine" gold foil
  and "Thank You" silver foil where the foil is the dominant
  surface and printed ink sits on top).
- **Luminescent amplified**: substrate brightness ×1.18 → ×1.45;
  pulse amplitude doubled; hotspot focus widened (5.0 → 3.5);
  outer-halo additive term; edge band 0.45 → 0.75; baseline pulse
  bloom 0.18 → 0.35. Reads as a real light source, not tinted vinyl.
- **Gold palette pushed warmer** after a tuning round: BASE
  rgb(1.00, 0.78, 0.20) — pure red, blue dropped — so peaks stay
  yellow instead of neutralizing to cream.
- Mode dispatch in shader main():
  1=holographic / 2=holographic_transparent / 3=luminescent /
  4=eggshell_holographic / 5=silver / **6=gold**.
- `effectModeFor(material)` maps:
  - holografico → holographic
  - holografico_transparente → holographic_transparent
  - eggshell_holografico → eggshell_holographic
  - luminiscente → luminescent
  - plateado → silver
  - dorado → gold

**G. Editor — geometric shape ergonomics**
- New shape: **Óvalo** (fixed 2:1 horizontal aspect, "ID badge").
  Distinct from círculo which fits an ellipse to the image's natural
  aspect.
- **Negative margins** on geometric shapes (cuadrado / circulo /
  oval / redondeadas): slider min is `-30 mm` for geometric, `5 mm`
  for contorneado (real die-cut tolerance). Customer can crop INTO
  the artwork (e.g. cut off the edge of a logo on purpose).
- **Shape buttons lock** once a shape is committed (geometric =
  picked, contorneado = Auto cut / Smart cut ran). Other shape
  buttons grey out with a "Tocá Borrar para cambiar de forma."
  hint. Fixes the shape→shape glitch where stale state bled across.
- **Drag-to-move** geometric shapes. Click + hold inside the mask;
  cursor switches to `grab`. Pointer plumbing exposed via
  `useCanvasEditor.beginPointerDrag(event, onMove, onEnd)` and
  `pointerToImagePixels(event)` (composable owns the canvas-px →
  image-px conversion via the fit transform). New `shapeOffset`
  ref in EditorView translates every polygon vertex.

**H. Editor — UI cleanup**
- "Vista" section (Línea de corte + Quitar fondo toggles) hidden
  by `<template v-if="false">` per client request — defaults
  (maskVisible=true, removeBackground=false) match the production
  render anyway, and the toggles confused customers. Restore by
  flipping the v-if.
- **Skip upload screen**: "Subir mi diseño" goes directly to the
  editor with an empty-state dropzone. Stepper collapsed from 4 to
  3 steps (Diseñar / Material y tamaño / Resumen).
- **Material y tamaño** simplified: removed redundant material +
  shape pickers (already in the editor). Acabados radio
  (none/relieve/brillo/opaco) replaces the four independent
  checkboxes; tinta blanca stays independent.

**I. Layout polish**
- AppToast moved from `top-4` → `top-20 md:top-24` (was crashing
  into the sticky header).
- AppHeader opacity bumped `bg-bg/80` → `bg-bg/95` (translucent
  bleed looked like a duplicate header band on scrolled pages).
- HomeView hero dropped its mobile fixed-height + overflow-hidden
  that was clipping the "Subir mi diseño" CTA on narrow viewports.

**J. Test hygiene**
- Playwright `seedActiveCustomer` accepts `email` / `first_name` /
  `last_name` / `can_reserve_orders` overrides; sets phone
  `+34 600 000 000` for all seeded customers.
- `seedOrderForCustomer` accepts `with_original_file: true`
  (attaches a stub PNG so place_order's file-existence guard
  doesn't fire in reservation specs).
- New helpers: `seedDiscount({code, percent_off, is_enabled?})`,
  `trackSeededProductSlug(slug)`, `runInBackendShellScript(py)` for
  multi-line cleanup scripts.
- New specs this session: reservations (4), admin-users (3),
  admin-orders extensions for status dropdown + shipped popup +
  download previews (3), holographic-fx walks 6 materials now
  (was 4), catalog public browse extends with sale-price spec,
  discount.spec.ts (3). Total 72+ specs passing.

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

### Done (Session 2026-05-09 — smart-cut / Recorte inteligente)

The editor now has TWO cut paths instead of one. The customer picks via
toolbar buttons:

- **Auto cut** (✂️) — classical OpenCV.js in a Web Worker. Fast (~1 s),
  in-browser, customer-tunable margin slider, three-strategy detection
  (alpha → bg-trim w/ perimeter flood → Canny). Default for most images.
- **Recorte inteligente** (✨) — server-side rembg AI background removal
  (`isnet-general-use`). Server round-trip ~3-5 s including inference.
  No customer-tunable params. Much better on photos and busy backgrounds.

Both write to the same `die_cut_mask` slot via `getMaskAsBlob`. The
toolbar disables both during processing of either; the
`editor-processing` banner reflects whichever is running.

Important contract details:
- Smart cut returns the tight artwork outline only (no bleed offset).
  The bleed-margin slider does NOT inflate the smart-cut polygon today
  — re-running classical Auto cut is the way to add bleed.
- Smart cut requires the `original` file to be uploaded; the button is
  disabled until then. The button is also disabled for non-contorneado
  shapes.
- Wire format on `SmartCutResponse`: `{kind, points, artwork_points,
  area_px}` — snake_case matches the rest of the order API.
  `artwork_points` mirrors `points` in this version (reserved for M3b
  if backend offset moves server-side).

`onSmartCut` handler in `EditorView.vue` translates HTTP errors:
- 503 → "El recorte inteligente no está disponible. Intentá Auto cut."
- 400 → "Subí tu diseño antes de usar Recorte inteligente."
- 200 + kind=no-contour-found → banner: "No pudimos detectar el contorno
  automáticamente. Probá con otra imagen o usá Auto cut."

#### Polishing work later in the same session (uncommitted as of EOD)

Customer feedback after the initial ship:
1. Need to lock out classical Auto cut while smart-cut is active (overwriting
   was a foot-gun — clicking ✂️ replaced the AI result with the classical
   one, rarely what they wanted).
2. Margin slider should re-inflate the smart-cut polygon LOCALLY (no
   server round-trip per slider drag).
3. The bleed margin should look like an extension of the source artwork's
   feel — for the gorilla on teal, customer wanted teal vinyl extending
   outward, not random truncated artwork bits from the source PNG.

State added to `EditorView.vue`:
- `cutMode: 'auto' | 'smart' | null` — drives margin slider behavior
  (smart → local re-offset; auto → debounced OpenCV re-run).
- `smartCutTightPoints: ImagePoint[] | null` — the rembg-detected tight
  silhouette saved so the slider can re-offset locally.
- `originalImageSrc: string | null` — remembers the customer's original
  upload so we can restore the canvas base layer after smart-cut swaps
  in the cleaned RGBA (when classical Auto cut runs OR when shape
  changes away from `contorneado`).

Helpers added:
- `applySmartCutWithMargin()` — pipeline: tight rembg silhouette →
  margin-aware perimeter-Gaussian pre-smooth (passes scale 1 per 8 px,
  min 5, max 50) → `offsetPolygonOutward` → canvas. The pre-smoothing
  scales with offset distance to prevent self-intersections at high
  margins.
- `restoreOriginalBaseImage()` — fire-and-forget swap back to the
  original photo when leaving smart-cut mode.

New file: `src/utils/polygon.ts` — main-thread mirror of the worker's
`offsetPolygonOutward` + `smoothPolygonPerimeter` (moved out of the
canvas composable so the smart-cut math + the canvas renderer can both
import it). Keep this file in sync with `src/workers/autoCrop.worker.ts`.

`EditorToolbar` got a new `isSmartCutActive` prop that disables the Auto
cut button while smart-cut is active. The Smart cut button stays
enabled — clicking it again re-runs detection.

`EditorView` swaps the canvas base layer to a `cleaned_image_data_url`
(base64 PNG) returned by the smart-cut endpoint. Same dimensions as the
original so coordinate math survives, but pixels outside the rembg
silhouette have alpha=0. When margin expands past the artwork edge, the
bleed area is genuinely transparent (composites against canvas checker
or material halo) instead of showing truncated source-image artwork.

#### Known issue carried into tomorrow — DO NOT COMMIT YET

**Margin slider on smart-cut still produces visual breakage at high
margin values on complex artwork.** Specifically: the gorilla
illustration at margin 25-30 mm shows the silhouette PLUS long curving
"tendril" artifacts extending outward from the silhouette.

Diagnosis:
- The rembg output for that gorilla includes single-pixel-wide bridges
  between the main body and decorative leaves around it. The contour
  walker traces the entire connected component, walking IN to the
  body, OUT along each thin leaf bridge to the leaf tip, BACK along
  the same bridge. When that boundary is offset outward, each "in-out"
  trip becomes a long curving outward tendril perpendicular to the
  bridge direction.
- Backend countermeasure (uncommitted): morphological opening on the
  rembg alpha (`PIL.ImageFilter.MinFilter(13)` then `MaxFilter(13)`)
  before contour tracing, which should drop thin appendages narrower
  than 13 px. Tested on the 64×64 mock fixture — passes. **Customer
  report says the bug persists on the real gorilla image.**
- Frontend countermeasure (also uncommitted): margin-scaled pre-
  smoothing pass (1 per 8 px) before `offsetPolygonOutward`. Helps
  on simple silhouettes but doesn't fully resolve the in-out leaf-
  bridge structure.

Three hypotheses for next session, in cheapness order:

1. **Pick the LARGEST connected component** in `_walk_alpha_contour`
   instead of the first inside pixel scanning row-major. The morph-
   open might be partially separating the body from a stray
   decoration, and the walker is picking up the smaller stray island.
   Tiny patch in `apps/orders/cut_path.py`.

2. **Bump the morph-open kernel to 21 or 31 px**. Risks eroding
   wider-but-legitimate fur tufts but might be necessary for this
   image's leaf-bridge widths. Trivial constant change.

3. **Use a real polygon-offset library** (Clipper2 or similar). The
   current normal-bisector offset is mathematically incorrect for
   non-convex polygons — sharp concavities always self-intersect. A
   proper implementation does inset/offset Boolean-style and produces
   a clean simple polygon at any distance. Real dependency add but is
   the only fully-correct fix.

Try (1) first — small, targeted, cheapest diagnostic. If artifacts
persist, escalate to (3).

#### Reproduction steps for tomorrow

1. Upload `/Users/cevichesmac/Desktop/gorila_logo.png`.
2. Click ✨ Recorte inteligente.
3. Expect: clean silhouette around the gorilla head.
4. Drag "Margen alrededor" slider to 30 mm.
5. **Bug**: long orange tendrils extend outward from the silhouette.
6. Expected: smooth simple curve following the silhouette, ~30 mm
   outward from it.

Files to look at first:
- `endossutdio_backend/apps/orders/services_smart_cut.py` (kernel size,
  contour-picking logic)
- `endossutdio_backend/apps/orders/cut_path.py:_walk_alpha_contour`
  (consider returning the largest island, not the first)
- `endosstudio_frontend/src/utils/polygon.ts` (`offsetPolygonOutward`,
  potential Clipper2 replacement)
- `endosstudio_frontend/src/views/EditorView.vue:applySmartCutWithMargin`
  (the orchestration — verify the smoothed polygon actually survives
  the wrap into ImagePoint[] and the canvas render).

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

### Done (Session 2026-05-10 — smart-cut perf + holographic FX rebuild)

Big session. Three major threads, all shipped + on `main`.

#### A. Smart-cut margin slider — proper backend dilation (resolves the gorilla bug)

The gorilla margin bug from EOD 2026-05-09 was the catalyst. Final fix:
move the polygon expansion to the backend.

- **Backend** (`apps/orders/services_smart_cut.py`):
  - New `margin_mm` parameter (clamped to MIN_MARGIN_MM=5).
  - Replaced PIL `MaxFilter` dilation with `scipy.ndimage.binary_dilation`
    — same Minkowski-sum semantics, ~1000× faster on big kernels.
  - Mask processing pipeline (morph-open → bleed dilate → contour walk)
    runs on a downsampled 512-px-long-edge copy. Polygon coords scale
    back to natural pixels before serializing. Final RGB compose stays
    full-res.
  - Cleaned RGBA preserves ORIGINAL source RGB pixels in the bleed
    ring (gated by the dilated alpha mask) — gives the "background
    extends outward" feel the customer asked for.
  - Gaussian-smooth pass on both artwork and cut masks before contour
    walking, controlled by new `smoothness` param (1-10, default 5).
    Fills narrow concavities a vinyl plotter can't physically follow.
  - rembg session warmed in a background thread at Django boot
    (`apps/orders/apps.py`). First customer no longer eats the 25-40 s
    cold-start.

- **Frontend** (`src/composables/useHolographicFX.ts` and EditorView):
  - Removed the broken JS `offsetPolygonOutward` path (per-vertex
    normal-bisector offset is mathematically wrong on non-convex
    polygons; produced self-intersection at large margins).
  - Margin slider now re-calls the backend debounced 600 ms.
  - Smoothness slider also re-calls when in smart-cut mode.
  - Per-call axios timeout bumped to 90 s for cold starts.
  - Slider min bumped to 5 mm (printable floor); first smart-cut
    bumps margin to 15 mm if customer hadn't moved the slider.

Real timings on the gorilla (warm session): **~2.3 s end-to-end**
(was ~10-15 s warm + 33 s cold-start). Per-step timing logs left in
service for regression detection.

Companion frontend changes: bleed-margin slider, smoothness slider,
new error states, 5 new Playwright specs.

#### B. WebGL holographic FX layer (replaces 2D drawHolographicOverlay)

The `drawHolographicOverlay` was a flat 2D screen-blend gradient.
Replaced with a real GLSL fragment shader in a new 4th canvas layer.

- New file: `src/composables/useHolographicFX.ts` — owns the WebGL
  context, vertex/fragment shaders, polygon stencils (rasterized at
  drawingBuffer DPR resolution to avoid 1-2px alpha-soft halos),
  texture upload, rAF render loop, mouse-anchored shimmer.
- New canvas in CanvasStage between base and ui layers. CSS
  pointer-events:none so the UI canvas keeps focus.
- Drives off `effectMode` ref in useCanvasEditor. EditorView maps the
  customer's chosen material → mode via `effectModeFor()`.
- 4 distinct material modes:
  - `holographic` — cool foil (cyan/violet/pink/gold/lime), sharp
    tight bands, focused hotspot
  - `holographic_transparent` — same palette, stronger artwork-
    interior reflections (no opaque white backing)
  - `eggshell_holographic` — warm pastel palette (peach/rose/lavender/
    cream/mint), broad SOFT bands (paper-printed feel)
  - `luminescent` — phosphorescent yellow-green glow concentrated at
    the cut edge + soft mouse hotspot. Only autonomous-time-driven
    mode (gentle 3-second pulse).
- Architecture: "clear lacquer over opaque ink". Artwork-interior FX
  alpha is DRIVEN BY a sparse highlight pattern (3 diagonal bands ×
  mouse-anchored hotspot) — most artwork pixels get FX alpha 0 →
  artwork shows through 100% intact, blacks stay black. Bleed area
  gets full holographic field.
- Standard alpha blending (no mix-blend-mode tricks). Earlier attempts
  with `screen` blend universally washed out artwork — screen() can't
  preserve a black pixel under any non-black overlay.

3 new Playwright specs verifying the FX layer mounts, doesn't block
UI events, and switching across all 4 modes doesn't crash.

#### C. AI macro reference textures (Track 2)

Per-material photoreal grain textures on top of the procedural shader.
Generated via DALL-E 3 (ChatGPT Plus) using prompts in
`docs/material-textures-prompts.md`.

- 4 PNGs in `src/assets/textures/`:
  - `holografico_macro.png` (3.6 MB)
  - `holografico_transparente_macro.png` (3.1 MB)
  - `eggshell_holografico_macro.png` (3.3 MB)
  - `luminiscente_macro.png` (2.8 MB)
- Vite glob (`import.meta.glob('@/assets/textures/*_macro.png')`) auto-
  discovers them — drop a new PNG and it picks up next reload.
- Shader samples them as a multiply layer on top of the procedural
  gradient. Per-material strength: foil 0.45, transparent 0.40,
  eggshell 0.30, luminescent 0.20 (luminescent wants the glow to
  dominate, not the particle texture).
- Graceful no-op fallback when the PNG isn't bundled (early in the
  session before generation, the code shipped without textures and
  fell back to procedural-only without errors). 1 new Playwright spec
  proves the fallback path.

Tileability not verified — DALL-E 3 doesn't natively produce seamless
tiles. Visible seams might appear at canvas midpoints; if so, run
each PNG through a seamless-pass tool (Photoshop "Offset" filter or
imgonline.com.ua's seamless tool) and replace.

#### D. Bug fixes shipped along the way

- `EditorView.vue:290` — `hasOriginalFile` computed used
  `order.value?.files.some()` but missed the optional chain on
  `.files`. Surfaced as "Cannot read properties of undefined (reading
  'some')" toast during smart-cut reactivity churn. Fixed.
- `apps/orders/views.py` — `OrderViewSet.partial_update` returned
  `OrderUpdateSerializer.data` (write-only fields, no `uuid`).
  Frontend stored that as `order.value`; subsequent code reading
  `order.value.uuid` got undefined → POST to `/orders/undefined/...`.
  Fixed to return `OrderSerializer.data` (mirrors the
  ProductViewSet pattern).
- WebGL FX boundary mismatch — stencil rasterized at CSS resolution
  but WebGL canvas runs at DPR; LINEAR upsampling caused 1-2 px
  iridescent fringe leaking past the cut polygon. Fixed by
  rasterizing at `drawingBufferWidth/Height`. Plus the stencil now
  uses the same `smoothPolygonPerimeter` + Chaikin trace the base
  canvas uses, so the shapes align exactly.

**Tests**: **54/54 functional Playwright specs passing** (was 50/50).

#### Files added in 2026-05-10

```
src/composables/useHolographicFX.ts             NEW   WebGL FX composable
src/assets/textures/*_macro.png                 NEW × 4
docs/material-textures-prompts.md               NEW   AI prompt pack
tests/e2e/holographic-fx.spec.ts                NEW   FX specs (4 tests)
tests/e2e/smart-cut.spec.ts                     NEW   smart-cut specs (5 tests)
endossutdio_backend/apps/orders/apps.py         MODIFIED rembg boot warmup
endossutdio_backend/apps/orders/services_smart_cut.py  REWRITTEN scipy + downsample + Gaussian smoothing
endossutdio_backend/apps/orders/views.py        MODIFIED smart-cut params + PATCH fix
```

### Open follow-ups (non-blocking)

- **Holographic should TINT the artwork's background, not overlay**
  (carried into next session — see "Pick up here tomorrow" up top).
  When the smart-cut bleed area carries colored source pixels (e.g.
  gorilla on teal), today's WebGL FX paints rainbow over the teal.
  Customer's mental model: the foil reflects the teal. Three fix
  candidates documented in the pickup section.
- **Macro PNG tileability** — DALL-E 3 outputs aren't seamless. May
  show grid lines at canvas midpoints when the shader tiles 2× across
  the surface. If visible, run each PNG through Photoshop's "Offset"
  filter or imgonline.com.ua's seamless-pass tool. Note: the artwork
  was generally noisy enough that seams might not actually show; QC
  by eye first.
- **Cut path SVG download from admin** — backend generates one at
  `transition_to_paid`; could surface a download link on the
  Dashboard's order detail. M3 nice-to-have.
- **More materials** — if the shop adds finishes (e.g. matte vinyl,
  textured), add the texture PNG to `src/assets/textures/` and one
  entry to `MATERIAL_TEXTURE_URLS`. ~5 LOC per material. For
  holographic SKUs also generate a `_macro.png` per the prompt pack.
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
