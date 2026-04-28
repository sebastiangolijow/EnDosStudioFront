# StickerApp Frontend — AI Context

> **Studio**: YeKo Studio · **Client**: Barcelona print shop selling custom stickers
> **Stack**: Vue 3 · Vite · TypeScript · Vue Router · Pinia · Tailwind CSS · Axios · Canvas API · OpenCV.js (CDN)
> **Backend**: separate Django + DRF project at `/Users/cevichesmac/Desktop/yeko_studio/endossutdio_backend/` (https://github.com/sebastiangolijow/EnDosStudioApp)
> **Status**: greenfield — no code committed yet. CLAUDE.md is the source of truth until the bootstrap skill runs.

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

A SPA that lets a customer upload a design, watch the app auto-detect the cut line, paint relief zones, preview the result, and place an order. Nine screens, plus admin.

**Customer flow**:

1. Land on home → "Tu diseño. Tu sticker. Sin límites." → click "Subir mi diseño"
2. Register / login (or guest if business allows)
3. Upload PNG/JPG → drag-drop with size + format validation
4. Editor opens → image renders on canvas → click "Auto cut" → OpenCV detects contour → user accepts/refines
5. Switch to Relief mode → paint zones with brush → undo/clear available
6. Preview → see final sticker rendering with toggles (Plano / Holográfico / Sobre superficie)
7. Order config → choose material, size, quantity → see live price estimate
8. Checkout → shipping address + Stripe payment
9. Confirmation → order number, link to dashboard

**Admin flow**:
1. Admin orders table → filters (status, date, customer, material) → click row
2. Order detail → view original image, cut mask, relief mask → download production files → change status

**Auth model**:
- Customers: self-registration (with optional guest checkout fallback)
- Shop staff / admin: created server-side, log in via the same login screen

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
│   │                           # CutOverlay, ReliefOverlay, ZoomControls, ProcessingOverlay
│   ├── order/                 # MaterialSelector, SizeSelector, QuantityStepper, OrderSummary
│   └── admin/                 # AdminOrderTable, AdminOrderDetail
├── composables/               # useAuth, useUpload, useOpenCV, useStickerCanvas,
│                              # useCutDetection, useReliefMask, useOrders
├── stores/                    # auth.store, sticker.store, order.store, ui.store
├── views/                     # 12 view files matching routes
├── services/                  # api, auth.service, upload.service, orders.service
├── types/                     # auth, sticker, order, api
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

- `POST /api/auth/login/` returns `{ access, refresh, user }`
- Store both tokens; default `axios` `Authorization: Bearer <access>`
- On 401: try `POST /api/auth/token/refresh/`; on refresh failure, force re-login
- Logout: `POST /api/auth/logout/` + clear local storage

The `useAuth` composable owns this; views never touch tokens directly.

### Customer registration creates inactive users

Per the backend's contract: registration creates `is_active=False, is_verified=False`. The customer receives an email with a setup link → they hit the frontend's `/set-password?token=...&email=...` page → frontend POSTs to `POST /api/v1/users/set-password/` → backend activates the account.

Frontend handles this via:
- `RegisterView` → call `POST /api/auth/register/` → show "check your email" message (do NOT auto-login)
- `/set-password` route → `SetPasswordView` reads token + email from query string → POSTs to `/api/v1/users/set-password/` → on success, redirects to `/login`

**Gotcha**: the user can't log in until they've completed set-password. Don't try to log them in immediately after register.

---

## 📡 API contract (from §4.12 of the design pack)

The backend exposes these endpoints. The frontend services file should map 1:1 to this list — no inventing endpoints.

### Auth
- `POST /api/auth/register/` — creates inactive customer, sends setup email
- `POST /api/auth/login/` — returns JWT pair
- `POST /api/auth/logout/` — blacklists refresh token
- `POST /api/auth/token/refresh/` — refresh JWT
- `GET  /api/auth/me/` — current user profile
- `POST /api/v1/users/set-password/` — activate account from email link

### Sticker drafts
- `POST  /api/sticker-drafts/` — create draft
- `GET   /api/sticker-drafts/:id/` — retrieve
- `PATCH /api/sticker-drafts/:id/` — update metadata
- `POST  /api/sticker-drafts/:id/upload-original/` — upload PNG/JPG (multipart)
- `POST  /api/sticker-drafts/:id/upload-cut-mask/` — upload cut PNG (multipart)
- `POST  /api/sticker-drafts/:id/upload-relief-mask/` — upload relief PNG (multipart)

### Orders
- `POST  /api/orders/` — create from a draft
- `GET   /api/orders/` — list user's orders
- `GET   /api/orders/:id/` — order detail
- `PATCH /api/orders/:id/` — partial update (e.g. shipping)
- `POST  /api/orders/:id/checkout/` — Stripe PaymentIntent → returns `client_secret`

### Admin
- `GET   /api/admin/orders/` — admin list (filterable)
- `GET   /api/admin/orders/:id/` — admin detail
- `PATCH /api/admin/orders/:id/status/` — change status

**Note on the path mismatch**: `set-password` lives at `/api/v1/users/set-password/` (Django's `users.urls`), while everything else in this contract uses `/api/...`. Sebastián confirmed this is fine — the version prefix is consistent server-side; we'll adjust the API base URL to match whatever the backend ships.

---

## 🚧 Status (project start)

### Done
- ✅ Folder created at `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_frontend/`
- ✅ CLAUDE.md written (this file)
- ⏳ `bootstrap-stickerapp-frontend` skill (in progress — see `~/.claude/skills/`)

### Next (after the skill exists)
- Run the bootstrap skill to lay down Phase 1 (Vite + Tailwind + tokens.css + router + Pinia stores + base layout + UI components)
- Move the design pack PDF into `docs/`
- First view to implement: `HomeView` (matches the mockup hero)

### TODO (radar)
- Decide hosting (Vercel / Netlify / self-hosted via the backend's nginx?)
- Decide guest checkout: yes or no? (PDF says "if business allows")
- OpenCV.js version pinning (currently using `4.x` from CDN — pin to a specific version once we test)
- Fonts: pick Inter vs Satoshi vs Manrope — design pack says "or similar"

---

## 🔗 Reference: backend codebase

`/Users/cevichesmac/Desktop/yeko_studio/endossutdio_backend/` (https://github.com/sebastiangolijow/EnDosStudioApp)

The Django backend is a sibling project. Read its `CLAUDE.md` to understand the API contract, auth flow (especially the allauth EmailAddress trap), and the file-upload model.

The backend is greenfield too — when this frontend session runs, the backend may also be unbootstrapped. Don't assume the API is live; mock as needed and wire to the real endpoints when both sides are ready.

---

## 📂 Files / paths to know

- **Design pack (source of truth)**: `/Users/cevichesmac/Downloads/Stickerapp Frontend Design Pack.pdf` (move into `docs/` at first scaffold)
- **Sibling backend project**: `/Users/cevichesmac/Desktop/yeko_studio/endossutdio_backend/`
- **YeKo Studio context**: `/Users/cevichesmac/Desktop/yeko_studio/yeko_studio_context.md`
- **Bootstrap skill**: `~/.claude/skills/bootstrap-stickerapp-frontend/`
- **Mockup image** (optional reference): the screenshot the user provided in the bootstrap session — captures landing + editor + upload + material selector + dashboard layouts in one frame

---

*Index file. Edit when conventions change or new gotchas surface. Keep it short — push detail into per-component docs as the codebase grows.*
