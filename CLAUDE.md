# StickerApp Frontend — AI Context

> **Studio**: YeKo Studio · **Client**: Barcelona print shop selling custom stickers
> **Stack**: Vue 3 (Composition API + `<script setup>`) · Vite · TS · Vue Router 4 · Pinia · Tailwind · Axios · Canvas + WebGL · OpenCV.js (CDN, in Worker)
> **Backend**: `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/` (Django + DRF). Source of truth for API shapes — read its serializers, not the design pack.
> **Status (2026-05-13)**: 🟢 **LIVE at https://endosestudio.com**. Hostinger KVM VPS (Ubuntu 24.04, Frankfurt, IP `187.124.29.215`). docker compose (db + web + nginx), Let's Encrypt TLS, Gmail SMTP working end-to-end (verification emails arrive in <30s), rembg warmed at boot. WordPress moved to DreamHost VPS `vps70246` at `wp.endosestudio.com`, reverse-proxied behind a hidden path `/k7p2x9/`. **Only missing piece**: CheckoutView Stripe Elements mount — backend PaymentIntent flow works (Stripe test sandbox keys configured, customer can place orders, PI gets minted), but the frontend still shows a placeholder where `<PaymentElement>` should be. Once that ships, deploy is feature-complete.

---

## Mindset (non-negotiable)

- Simple > complex. Composable before class, in-house component before UI lib.
- Frontend keeps frontend work: pixel ops (edge detect / mask gen / preview compositing) happen in browser via OpenCV.js + Canvas. Backend stores files; does NOT process pixels (exception: smart-cut runs rembg server-side).
- UI components are dumb (props/emit, no stores/services). Composables hold business logic. Stores hold app state. Services hold API calls. Views are thin orchestrators — no fetches in `<script setup>`.
- Single source of truth for material visuals: `src/utils/materialColors.ts` (swatches AND halo AND inspector all read from it).

---

## Stack — locked

Vue 3 / Vite / TS / Vue Router 4 / Pinia / Tailwind / Axios / Canvas + OpenCV.js (CDN, worker-loaded) / WebGL FX layer.

**NOT in stack**: no Vuex, no UI lib (Vuetify/PrimeVue), no CSS-in-JS, no Storybook day 1, no animation lib day 1, no Fabric.js unless drawing complexity justifies it.

---

## Design tokens — locked (from design pack §2)

Implement in `src/styles/tokens.css` + `tailwind.config.ts`. Never hardcode hex.

**Colors**: `--color-bg #050708` · `--color-surface-1 #111418` · `--color-surface-2 #1B2027` · `--color-border #2A3038` · `--color-text #F5F3EF` · `--color-text-muted #AEB4BD` · **`--color-primary #FF3D0A`** (EN DOS orange) · `--color-primary-hover #FF5A24` · `--color-primary-dark #B92808` · `--color-cyan #22D3EE` · `--color-violet #A855F7` · `--color-lime #A3E635` · `--color-warning #FACC15` · `--color-success #22C55E` · `--color-error #EF4444`.

**Gradients**:
```css
--gradient-holographic: linear-gradient(135deg, #22D3EE 0%, #A855F7 38%, #FF3D0A 65%, #A3E635 100%);
--gradient-orange-glow: radial-gradient(circle, rgba(255,61,10,.35) 0%, rgba(255,61,10,0) 70%);
```

Holographic accents used sparingly (selected MaterialCard borders, hero highlights, hover).

**Spacing** (4px scale): `xs=4 sm=8 md=16 lg=24 xl=32 2xl=48 3xl=64`.
**Radius**: `sm=8 (inputs) md=12 (btn) lg=18 (card) xl=24 (panel) full=999 (pill)`.
**Shadows**: `--shadow-card 0 12px 40px rgba(0,0,0,.35)` · `--glow-orange 0 0 24px rgba(255,61,10,.45)` · `--glow-cyan 0 0 24px rgba(34,211,238,.35)`.
**Type**: Inter primary. Display XL 64/72, L 48/56, H1 40/48, H2 32/40, H3 24/32, Body 16/24, Small 14/20, Micro 12/16. Weights 400/500/600/700-800.

---

## Folder structure (current)

```
src/
├── assets/
│   ├── logo/ examples/
│   └── textures/                 # MATERIAL TEXTURES:
│                                 # halo layer (bundled 512×512):
│                                 #   holografico, holografico_transparente,
│                                 #   dorado, plateado, eggshell,
│                                 #   eggshell_holografico, vinilo_blanco, luminiscente
│                                 # macro layer (WebGL FX, 1024×1024 DALL-E 3):
│                                 #   holografico_macro, holografico_transparente_macro,
│                                 #   eggshell_holografico_macro, luminiscente_macro
│                                 # (silver/gold = procedural-only, no macro PNG)
├── components/
│   ├── ui/                       # AppButton AppInput AppCard AppModal AppToast
│   │                             # AppStepper AppBottomSheet StatusBadge
│   ├── layout/                   # AppHeader AppShell DashboardShell
│   ├── upload/                   # UploadDropzone FilePreview (main flow lands in editor directly)
│   ├── editor/
│   │   ├── CanvasStage.vue       # 4-layer stack: mask → base → fx (WebGL) → ui.
│   │   │                         # Forwards canvas-pointerdown so parent owns drag.
│   │   │                         # uiCursor prop ('grab' for geometric shapes).
│   │   ├── EditorToolbar.vue     # Auto cut + Smart cut + Borrar + Zoom + Deshacer/Rehacer
│   │   └── EditorInspector.vue   # right rail: Forma + Material + Relieve
│   │                             #   + Margen slider (5–30 contorneado, −30 to 30 geometric)
│   │                             #   + Suavidad slider. Vista block hidden v-if=false.
│   │                             #   Shape buttons lock once a mask is active.
│   ├── catalog/                  # ProductCard (strikethrough sale price), CatalogOrderSummary
│   └── order/                    # MaterialCard ShapeCard SizePicker QuantityStepper
│                                 # OrderSummary (Subtotal − Descuento + IVA = Total)
│                                 # ShippingForm (country dropdown + phone + email)
│                                 # OrderHistoryCard
├── composables/
│   ├── useAutoCropWorker.ts      # singleton Worker + requestId-keyed promise map
│   ├── useCanvasEditor.ts        # canvas state, fit transform, mask/halo/clip,
│   │                             #   effectMode + setEffectMode for FX,
│   │                             #   beginPointerDrag + pointerToImagePixels for drag-to-move
│   ├── useHolographicFX.ts       # WebGL FX. 6 modes. GLSL frag shader. DPR stencils.
│   │                             #   Mouse-anchored shimmer. Macro texture sampling.
│   ├── useAutoCrop.ts            # LEGACY main-thread. On disk, not imported.
│   ├── useOpenCV.ts              # LEGACY CDN-script gate. Reference only.
│   ├── useAuth.ts useToast.ts useNewSticker.ts
├── workers/autoCrop.worker.ts    # classic worker; importScripts(opencv.js);
│                                 # 3 strategies; emits {points, areaPx, artworkPoints?}
├── utils/
│   ├── materialColors.ts         # MATERIAL_TEXTURE_URLS (halo) + MATERIAL_MACRO_URLS
│   │                             # (import.meta.glob, auto-discovers _macro PNGs).
│   │                             # textureFill factory + per-material MaskPalette.
│   └── polygon.ts                # smoothPolygonPerimeter (Chaikin/Gaussian iterations),
│                                 # offsetPolygonOutward (legacy, not used today).
├── stores/                       # auth.store (isAdmin/isShopStaff helpers)
│                                 # order.store ui.store
├── data/countries.ts             # ISO 3166-1 alpha-2, Spanish names, ES pinned
├── views/                        # ~21 views: Home Login Register SetPassword
│                                 # Forgot/ResetPassword Dashboard Upload Editor
│                                 # OrderConfig Checkout Confirmation Catalog/Detail
│                                 # Admin{Orders,OrderDetail,Products,ProductForm,Discounts,Users}
├── services/                     # api.ts (axios + JWT refresh interceptor)
│                                 # auth.service orders.service (applyDiscount/reserve/
│                                 # adminSetStatus/listShippingCarriers)
│                                 # products.service users.service discounts.service files.service
├── types/
│   ├── auth.ts                   # User (incl. can_reserve_orders), RegisterPayload (phone_number required)
│   ├── order.ts                  # Order (discount_code/_cents/_eur, pickup_at,
│   │                             #   shipping_carrier/_tracking_code/_eta_date,
│   │                             #   shipping_method, shipping_phone/_email)
│   │                             # OrderStatus union incl. 'reserved'
│   │                             # Material + MATERIAL_LABELS
│   │                             # Shape + SHAPE_LABELS incl. 'oval'
│   │                             # ShippingMethod + SHIPPING_METHOD_LABELS
│   │                             # OrderFileKind, dimension/qty bounds
│   ├── product.ts                # Product CategoryRef ProductRef (sale_price,
│   │                             #   effective_price, weight_grams, category)
│   └── api.ts                    # Paginated<T> AsyncStatus
├── router/index.ts               # ~22 routes; requiresAuth/requiresStaff meta.
│                                 # /dashboard redirects to /admin/orders for staff.
└── styles/                       # tokens.css globals.css
```

---

## Critical recipes (gotchas already paid for)

### OpenCV.js in a Web Worker
- ~10MB WASM. Main-thread compile trips "Page Unresponsive."
- Worker: `src/workers/autoCrop.worker.ts` calls `importScripts(opencv.js)` (classic worker — module workers don't support importScripts).
- Wrapper: `useAutoCropWorker.ts` is module-scoped singleton, requestId → promise map.
- Loaded only when editor route opens (never from index.html).
- Every `Mat`/`MatVector`/contour `.delete()` in `finally`. Worker context is long-lived; leaks accumulate.

### Three-strategy auto-crop
| Strategy | Trigger | Pipeline |
|---|---|---|
| `alpha` | any α<250 | threshold α at 128 |
| `bg-trim` | opaque + perimeter stddev < 35 | sample bg, inRange + invert + close |
| `canny` | both above failed | Canny → findContours → max-area |

Each unions filtered contours into a filled mask → dilation for bleed margin → `approxPolyDP`. Strategy logged: `console.info("[autocrop] strategy=...")`.

### 3-layer canvas + mask BELOW base
DOM order: mask(0) → base(1) → ui(2). Mask is BELOW base by design — tight artwork polygon clips the base, halo shows only in bleed margin. Reorder = halo invisible.

### Tight clip + bleed clip
Worker returns 2 polygons: `points` (cut = artwork+bleed) and `artworkPoints` (tight silhouette, no bleed). `setMask(points, artworkPoints?)` stores both. `removeBackground` prefers tight one. Geometric shapes pass no artworkPoints (polygon IS the silhouette); clip falls back to cut polygon.

### Material textures vs transparent vinyl
8/9 materials use bundled PNG textures. `vinilo_transparente` has NO PNG — `transparentMaterial=true` drops base `globalAlpha` to 0.55 so canvas checker reads through. Do NOT add a transparent PNG; the alpha trick IS the design.

### Image size policy
OpenCV runs on **working-size** copy capped at 1024px long edge. Polygon coords scaled back to natural-image pixels. Original `File` uploads to backend; working-size canvas is editor-only.

### WebGL FX layer (6 modes)
4-layer stack: mask(2D) → base(2D) → fx(WebGL) → ui(2D). FX is a SEPARATE `<canvas>` driven by `useHolographicFX.ts`.

- WebGL canvas is its own DOM element. WebGL and 2D contexts are mutually exclusive on a single canvas.
- Idle when material isn't holo/luminescent: shader fades to 0 and rAF short-circuits.
- Polygon stencils rasterized at `drawingBufferWidth/Height` (DPR-aware), NOT CSS resolution — else 1-2px alpha-soft halo leaks past cut line. Uses same `smoothPolygonPerimeter` + Chaikin trace as base clip.
- Standard alpha blend (no mix-blend-mode). `screen` was tried and washed out blacks universally. Shader writes alpha=0 over most interior; only sparse highlight regions write visible iridescence → artwork stays 100% solid, reflections appear only where simulated light catches.
- 6 modes (shader main() is stacked if-ladder on u_mode, 0=off):
  1. `holographic` (cool foil, sharp bands)
  2. `holographic_transparent` (same palette + stronger interior alpha)
  3. `luminescent` (phosphor green-yellow, autonomous pulse, edge-concentrated; substrate ×1.45 + amplified hotspot/halo)
  4. `eggshell_holographic` (warm pastel, broad soft bands)
  5. `silver` (neutral chrome — gray 3-stop, white ink reads as bright silver)
  6. `gold` (warm 24k — saturated yellow with deep amber shadow + pale yellow peak)
- `effectModeFor(material)` mapping: holografico→1, holografico_transparente→2, eggshell_holografico→4, luminiscente→3, plateado→5, dorado→6.
- Macro textures sampled as multiply on top of procedural. Strengths in `TEXTURE_STRENGTH_BY_MODE`. Cached; missing PNG = procedural-only fallback. Drop `<material>_macro.png` in textures/, Vite glob auto-picks.

**Silver/gold alpha gotcha** (DON'T re-bug this):
```glsl
// WRONG — bright pixels got near-zero alpha; foil never showed
float ink_alpha = mix(0.92, 0.18, base_brightness);
// RIGHT — dark ink keeps faint sheen (0.22); white ink lets foil shine (0.95)
float ink_alpha = mix(0.22, 0.95, base_brightness);
```
Inverted density requires inverted alpha. Reference photos ("Born to shine" gold, "Thank You" silver): foil is dominant surface, ink sits on top.

### Async state pattern
```ts
const status = ref<AsyncStatus>('idle')
const error = ref<string | null>(null)
async function run() {
  status.value = 'loading'
  try { await action(); status.value = 'success' }
  catch (e) { error.value = String(e); status.value = 'error' }
}
```
UI reflects every state distinctly.

### Auth flow (Django/JWT)
- `POST /auth/login/` → `{access, refresh}` (or `access_token`/`refresh_token` — handle both: `r.data.access ?? r.data.access_token`).
- Default `Authorization: Bearer <access>`. On 401: try `/auth/token/refresh/`; refresh fail → force re-login.
- `useAuth` composable owns this; views never touch tokens.

### Registration creates inactive users
- `POST /auth/register/` → backend creates `is_active=False, is_verified=False`, sends email.
- Frontend: show "revisá tu email", do NOT auto-login.
- Backend returns 200 even for already-registered emails (no leak) — UI message identical in both cases.
- Customer hits `/set-password?token=...&email=...` → POSTs `/users/set-password/` → backend activates + creates allauth EmailAddress row. Without that row, login silently fails.

### Forgot password
- `/forgot-password` (or modal) → POST `{email}` to `/auth/password/reset/` → always show "check email" (no leak).
- Email links to `/reset-password?uid=...&token=...` → POST `{uid, token, new_password1, new_password2}` to `/auth/password/reset/confirm/` → redirect `/login`.

### Stripe checkout
After `POST /orders/{uuid}/checkout/` returns `{client_secret, payment_intent_id, amount_cents, currency}`:
1. Mount `<PaymentElement>` bound to `client_secret`. Don't render form before secret arrives.
2. `stripe.confirmPayment({elements, confirmParams: {return_url}})`. 3DS/iDEAL/Bizum redirect — `return_url` points at order detail on this frontend.
3. Webhook flips order to `paid` async. Frontend redirects to confirmation, polls `GET /orders/{uuid}/` ~5-15s until status flips.
4. `VITE_STRIPE_PUBLISHABLE_KEY` build-time env. Test: `4242...` ok, `4000...3184` 3DS, `4000...0002` decline.
5. Stripe NOT live yet — dummy keys → 502 on checkout. Mock layer in dev until keys land.

---

## API contract (M2/M3 backend — what's actually shipped)

Prefix `/api/v1/`. NO separate `/api/sticker-drafts/` (draft = `Order(status="draft")`). NO `/api/admin/...` (staff use Django admin OR same `/orders/` endpoints — queryset role-scoped server-side).

**Backend wins on API contracts; design pack wins on visuals.**

### Auth `/auth/`
- `POST /auth/register/` `{email, password, first_name?, last_name?, phone_number}` (phone REQUIRED) → 200, sends email
- `POST /auth/login/` `{email, password}` → `{access, refresh}` (handle both naming)
- `POST /auth/logout/`
- `POST /auth/token/refresh/` `{refresh}`
- `POST /auth/password/reset/` `{email}` → 200 always
- `POST /auth/password/reset/confirm/` `{uid, token, new_password1, new_password2}`

### Users `/users/`
- `GET /users/me/` — incl. `can_reserve_orders` (gates "Reservar y pagar en tienda")
- `POST /users/set-password/` — activates from verification link
- `GET /users/` **staff-only**, paginated. `?search=` (icontains email+name), `?can_reserve_orders=`, `?role=customer|shop_staff|admin`
- `PATCH /users/{uuid}/` **staff-only**, only accepts `{can_reserve_orders: bool}`

### Orders `/orders/`
- `GET /orders/` paginated. Customer→own; staff→all.
- `POST /orders/` empty body → draft owned by requester
- `GET /orders/{uuid}/`
- `PATCH /orders/{uuid}/` — material/dims/qty/add-ons/shipping/shipping_method/shipping_phone/shipping_email. **409 if status != draft.**
- `POST /orders/{uuid}/place/` — draft→placed. Validates required, computes total (discount+IVA). 409/400 on fail.
- `POST /orders/{uuid}/checkout/` — placed→Stripe PaymentIntent. Returns `{client_secret, payment_intent_id, amount_cents, currency}`.
- `POST /orders/{uuid}/cancel/` `{reason?}` — **customer-only**, only `{draft, placed}`
- `POST /orders/{uuid}/deliver/` — shipped→delivered. **customer-only.**
- `POST /orders/{uuid}/start-production/` — paid→in_production. **staff-only.**
- `POST /orders/{uuid}/ship/` — in_production→shipped. **staff-only.**
- `POST /orders/{uuid}/reserve/` — **customer-only, whitelist-gated.** `{pickup_at: ISO 8601}`. draft|placed → reserved. 400 'past' / 403.
- `POST /orders/{uuid}/admin-set-status/` — **staff-only force-status.** `{status, shipping_carrier?, shipping_tracking_code?, shipping_eta_date?}`. Bypasses guards. status='shipped' + tracking code fires shipping email.
- `GET /orders/shipping-carriers/` — **staff-only**, distinct carrier names. Powers `<datalist>` autosuggest.
- `POST /orders/{uuid}/apply-discount/` — **customer-only.** `{code}`. 404 'not_found' / 409 'disabled' / 409 'wrong_status'.

### Discounts `/discounts/` (all staff-only)
- `GET POST /discounts/` create `{code, percent_off, is_enabled?}`. Code uppercased server-side.
- `PATCH DELETE /discounts/{uuid}/`. Prefer disable over delete for audit-trail.

### Products `/products/`
- `GET /products/` public. Accepts `?is_active=true|false`. CatalogView always passes `true`. AdminProductsView passes nothing (sees inactive too).
- `GET /products/{slug}/` public, same gate.
- `POST PATCH DELETE` **staff-only**, multipart. `category` is free text (backend dedupes by slug). PATCH returns full read shape (uuid+slug+price_eur+sale_price_eur+effective_price_eur+category). DELETE 409 on PROTECT FK — use is_active=false instead.

### Categories `/categories/`
- `GET` public, read-only. Drives admin form autosuggest. Categories created implicitly via product POST.

### Order files `/orders/{uuid}/files/`
- `GET POST DELETE` multipart. Form fields EXACTLY `kind` and `file`. `kind ∈ {"original","die_cut_mask"}` (M2). `"relief_mask"` reserved.
- `unique_together(order, kind)` — DELETE then re-POST to swap.

### Pricing preview `/orders/quote/`
- `GET ?material=&width_mm=&height_mm=&quantity=&with_relief=&with_tinta_blanca=&with_barniz_brillo=&with_barniz_opaco=` → `{total_amount_cents, total_eur, currency}`. Pure function. Use for live slider updates.

### HTTP errors
- 400 validation · 401 not authed (refresh+retry, or login) · 403 forbidden (customer→staff endpoint, or cross-customer) · 404 not found/not yours · 409 wrong status for transition · 502 Stripe down (retry-friendly).

---

## Pricing model (locked, repriced 2026-05-09, IVA+shipping+discount 2026-05-12)

Backend `compute_total_cents()` is pure and deterministic. **Never duplicate on frontend — always call `/orders/quote/`.** For reference:

```
area_factor       = ((w_mm+15)/1000) × ((h_mm+15)/1000)         # m², bleed
work_subtotal     = area_factor × qty × material_price_eur
addon_multiplier  = 1 + 0.35*relief + 0.35*tinta_blanca
                      + 0.20*barniz_brillo + 0.20*barniz_opaco
                      + shipping_surcharge        # 0/0.20/0.60 = normal/express/flash
pre_discount      = max(work_subtotal × addon_multiplier, 20.00)  # €20 work floor
discount          = pre_discount × discount_percent / 100
pre_iva           = pre_discount − discount
total             = pre_iva × 1.21                               # 21% Spanish IVA
```

Add-ons + shipping compose ADDITIVELY (sum percents, multiply once). €20 floor on WORK only, before discount. Catalog orders have NO floor.

OrderSerializer exposes: `subtotal_cents` (pre-discount work), `discount_cents`, `iva_cents`, `total_amount_cents` (final).

**Materials** (€/m²/sticker):
| Key | Display | € |
|---|---|---|
| vinilo_blanco | Vinilo blanco | 45 |
| vinilo_transparente | Vinilo transparente | 45 |
| holografico | Vinilo holográfico | 50 |
| holografico_transparente | Vinilo holográfico transparente | 50 |
| plateado | Vinilo plateado | 50 |
| dorado | Vinilo dorado | 50 |
| luminiscente | Vinilo luminiscente | 55 |
| eggshell | Vinilo eggshell | 55 |
| eggshell_holografico | Vinilo eggshell holográfico | 60 |

**Regression scenarios** (kept in tests):
- `vinilo_blanco 10×10 q=100 no add-ons` → **59.51€** (above floor) — with IVA → **72.01€**
- `holografico 5×5 q=50 no add-ons` → **20.00€** (floor)
- `vinilo_blanco 10×10 q=100 +relief +brillo` → **92.24€** (×1.55)

**Add-on UX**: Relieve + Tinta blanca = independent checkboxes. Barniz = single radio (`none/brillo/opaco`) but rides 2 booleans on wire (`with_barniz_brillo`, `with_barniz_opaco`).

**Constraints**: `width_mm`/`height_mm` multiples of 5, ≥25 (=2.5cm), shown in cm. `quantity` int 20–100,000.

---

## Wire format conventions (single biggest bug source)

- **UUIDs named `uuid`, not `id`**. `Order.uuid`, `OrderFile.uuid`, `User.uuid`. Mirror in TS.
- **Money = integer cents on wire** (`total_amount_cents: number`). Serializer also has `total_eur: string` ("110.00") — USE that for render, never `total_amount_cents/100` (float precision loss).
- **Status enums snake_case**: `"draft" "placed" "reserved" "paid" "in_production" "shipped" "delivered" "cancelled"`. Translate for display, wire stays snake_case.
- **`Order.kind`**: `"sticker"` (default) or `"catalog"` (M3a). Catalog orders carry `product` (UUID) + `product_quantity` instead of sticker spec fields. Nested `product_detail` (`name, slug, image, price_cents, price_eur`) saves a second fetch. Branch on `order.kind` in: CheckoutView, ConfirmationView, OrderHistoryCard, AdminOrderDetailView. UploadView/EditorView/OrderConfigView are sticker-only.
- **`OrderFile.kind`**: `"original" "die_cut_mask"`. Add `"relief_mask"` when drawn-mask feature ships.
- **Multipart upload fields EXACTLY `file` and `kind`** — anything else silently dropped.

The `api-contract-check` skill (`~/.claude/skills/api-contract-check/`) enforces these.

---

## Features shipped (current state)

### Customer flow
Home → Subir mi diseño → register (email verify) → login → **editor opens directly** (empty dropzone if no upload yet) → upload PNG/JPG → Auto cut (OpenCV) OR Smart cut (rembg server) → optional Relieve checkbox + free-text note (NO drawn mask in MVP) → Material y tamaño (material × size mm × qty 20-100k × acabados radio + tinta blanca + barniz radio) → live quote → Checkout (shipping: country dropdown, 2 street lines, city, postal, phone, email, shipping_method) → Stripe OR Reserve (whitelist) → Confirmation (order uuid).

Stepper: catalog=3, sticker=3 (collapsed from 4 — material+shape removed from OrderConfig since editor handles them).

### Admin flow
- Django admin (day-1 ops UI) + Vue admin (`/admin/orders`, `/admin/order/:uuid`, `/admin/products`, `/admin/discounts`, `/admin/users`).
- **Orders board**: status cards incl. `Borrador` + `Reservado`. Status dropdown + Aplicar button replaces individual transition buttons — force ANY status from ANY.
- **Shipped popup**: carrier (datalist autosuggest from past orders) + tracking + ETA → admin-set-status → fires customer email.
- Order detail: download original image + cut-line preview, tel:/mailto: links.
- **Discounts**: table + create/edit modal + toggle + delete. Code applied **after** €20 floor, **before** IVA. Disabled code at place/reserve silently falls back to 0% (audit trail preserved on `discount_code`).
- **Users whitelist**: toggle `can_reserve_orders` per-user.
- **Products**: sale_price_cents (strikethrough display), weight_grams (captured, no UI), category FK (free-text dedup). Catalog: 2/3/4/5 cols mobile→tablet→desktop→wide. Public endpoint respects `?is_active=true` (staff bypasses needed → would re-show hidden products on /catalogo).
- **Staff gating**: AppHeader "Panel admin" → /admin/orders for staff. Router redirects /dashboard → /admin/orders. CatalogDetail disables Comprar for staff.

### Reservations
- Whitelisted customers skip Stripe → reserve modal (date+time) → `pickup_at` stored → owner takes cash at pickup → flips to paid via admin dropdown.
- Status flow: draft|placed → reserved. ConfirmationView branches on status='reserved' (hero copy + pickup block "Pagás en efectivo al retirar"). AdminOrderDetail shows "Retiro en tienda" tinted block when pickup_at set.

### Email workflows (3 wired, sync send, SMTP failures logged not raised)
1. Customer order-received — fires `transition_to_paid` (Stripe webhook) AND `reserve_order`. Branches by status.
2. Owner new-order — same triggers. To `settings.SHOP_OWNER_EMAIL` (falls back to DEFAULT_FROM_EMAIL).
3. Customer shipping — fires `admin-set-status` when status=shipped + tracking code.

### Smart-cut (rembg server-side)
- `Recorte inteligente` (✨) on toolbar. Server round-trip ~2.3s warm, ~25-40s cold (warmed at Django boot).
- Backend: scipy.ndimage.binary_dilation, downsampled 512px-long-edge mask processing, Gaussian smooth (smoothness param 1-10), preserves source RGB in bleed ring.
- Returns `{kind, points, artwork_points, area_px}` snake_case. artwork_points = points in current version.
- Auto cut LOCKED OUT while smart-cut active (overwrite was foot-gun). Margin slider re-calls backend debounced 600ms. Per-call axios timeout 90s for cold start.
- Errors: 503→"no disponible, usá Auto cut" · 400→"subí tu diseño antes" · 200+kind=no-contour-found→"probá otra imagen o Auto cut".
- First smart-cut bumps margin to 15mm if customer hadn't moved slider. Slider min 5mm (printable floor).

### Geometric shape ergonomics
- Shapes: `contorneado` `cuadrado` `circulo` `oval` (2:1 horizontal "ID badge") `redondeadas`.
- Negative margins on geometric: slider min `-30 mm` (crop INTO artwork). Contorneado min `5 mm` (real die-cut tolerance).
- Shape buttons LOCK after commit (geometric=picked, contorneado=auto/smart ran). Other buttons grey + hint "Tocá Borrar para cambiar de forma."
- Drag-to-move: click+hold inside mask → cursor `grab` → `shapeOffset` translates every vertex. Plumbed via `useCanvasEditor.beginPointerDrag(event, onMove, onEnd)` + `pointerToImagePixels(event)` (composable owns canvas-px → image-px via fit transform).

### UI cleanup
- "Vista" section (Línea de corte + Quitar fondo toggles) hidden by `<template v-if="false">` (per client). Defaults (maskVisible=true, removeBackground=false) match production. Restore by flipping v-if.
- AppToast moved `top-4` → `top-20 md:top-24` (was crashing sticky header).
- AppHeader `bg-bg/80` → `bg-bg/95` (translucent bleed looked like duplicate band on scrolled pages).

---

## Status — pick up here

**Deployment infra landed (2026-05-13).** `deploy/` + `DEPLOYMENT.md` ship the LabControl-shape recipe (DreamHost VPS, docker compose, nginx, Let's Encrypt, Gmail SMTP, Stripe test mode day 1, WordPress co-tenant at `/tienda`). Backend Dockerfile now ENTRYPOINTs through `entrypoint.sh` (migrate + collectstatic before gunicorn). `/api/v1/health/` endpoint added for compose healthcheck. `.env.production.template` lives in both repos.

**Ready to execute on the VPS.** Sebastian has DreamHost SSH access, the domain, and the Gmail App Password. Run through `DEPLOYMENT.md` Phases 0→4. Stripe keys remain test-mode until live keys are swapped via §3.3 (env-update flow).

### Small follow-ups (non-blocking, post-deploy)
- **Macro PNG seamless-tile QC** — 4× `*_macro.png` may show grid lines at 2× tile boundary on large stickers. QC by eye on full-screen preview after deploy.
- **Catalog stock decrement** — wired at `transition_to_paid` but no E2E spec exercises paid→stock path. Add when Stripe live.
- **Cut-path SVG download from admin order detail** — backend generates at `transition_to_paid` but admin UI doesn't surface link. ~10 lines.
- **CheckoutView Stripe mount** — currently stubbed. Swap stub for real `<PaymentElement>` once Stripe test keys are pasted into `.env.production` and webhook secret is registered.

---

## Decision log

> Backend has its own log at `endossutdio_backend/CLAUDE.md` for its share (email provider, hosting, Stripe owner, webhook secret, media storage). This covers frontend-specific.

### Frontend hosting target
- **Status**: DECIDED 2026-05-13: **Self-hosted on the customer's DreamHost VPS behind our nginx**, single-origin with the backend. Vue dist/ rsynced from local `npm run build`. No SPA container. Same domain serves the app at root + WordPress at `/tienda` (existing customer site moved under a subpath).
- **Why**: customer already owns the VPS and the domain; WordPress co-tenancy required; single-origin removes CORS complexity; matches LabControl's proven recipe.
- See `DEPLOYMENT.md` for the runbook.

### Font loading
- **Status**: open. Inter locked as primary.
- **Recommendation**: **`@fontsource/inter`** dev dep, imported in main.ts. Already in package.json. Self-hosted via Vite asset pipeline.
- **Tradeoffs**: @fontsource = locked version + privacy + ~80KB bundle. Google Fonts CDN = smaller bundle but external request.
- **Trigger**: before first deploy.

### OpenCV.js version pinning
- **Status**: open. Worker uses `https://docs.opencv.org/4.x/opencv.js` — silent CDN drift risk.
- **Recommendation**: pin to e.g. `4.10.0` once 30 specs verified.
- **Trigger**: before first deploy, or sooner if auto-crop flakes without code change.

### Stripe checkout polling vs redirect
- **Status**: open.
- **Recommendation**: **redirect to `/confirmation/{uuid}` with poll there**. Survives 3DS/iDEAL/Bizum redirects. CheckoutView stays dumb. Confirmation polls `GET /orders/{uuid}/` ~5-15s until status flips to `paid`; surface "we're confirming, refresh in a minute" if not — never block customer.
- **Trigger**: when real Stripe keys land.

---

## Reference: backend codebase

`/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/` (https://github.com/sebastiangolijow/EnDosStudioApp)

Backend `CLAUDE.md` is source of truth for: API surface, auth (allauth EmailAddress trap), file-upload model, pricing constants.

When in doubt about endpoint shape, **read backend serializer file** not design pack:
- `apps/orders/serializers.py` — OrderSerializer, OrderFileSerializer, PriceQuoteSerializer, CheckoutResponseSerializer
- `apps/orders/views.py` — OrderViewSet, OrderFileViewSet, PriceQuoteView
- `apps/orders/services.py` — pricing constants, transition guards
- `apps/orders/services_smart_cut.py` — rembg pipeline
- `apps/orders/models.py` — Order, OrderFile, status/material choices, bounds
- `apps/orders/cut_path.py` — `_walk_alpha_contour` (largest island consideration)
- `apps/users/views.py` — RegisterView, SetPasswordView, CurrentUserView
- `apps/users/auth_urls.py` — full auth URL set
- `apps/payments/views.py` — StripeWebhookView (FE doesn't touch)

---

## Files / paths

- **Design pack**: `docs/design-pack.pdf` (source of truth for visuals).
- **Mockups**: `docs/mockups.jpeg`.
- **Archived sessions**: `docs/archive/SESSION_START.md` (bootstrap), `SESSION_2026_05_03_editor.md` (editor + Forma + materials). Historical only — current state lives in this file.
- **AI prompt pack for macro textures**: `docs/material-textures-prompts.md`.
- **Backend project**: `/Users/cevichesmac/Desktop/yeko_studio/endosstudio_project/endossutdio_backend/`
- **YeKo context**: `/Users/cevichesmac/Desktop/yeko_studio/yeko_studio_context.md`
- **Skills**: `~/.claude/skills/bootstrap-stickerapp-frontend/` `canvas-editor-system/` `opencv-js-integration/` `api-contract-check/` `playwright-frontend-test/`

---

## Open follow-ups (non-blocking)

- **Holographic should TINT artwork background, not overlay**: when smart-cut bleed carries colored source pixels (e.g. gorilla on teal), FX paints rainbow OVER teal. Customer mental model: foil REFLECTS teal. Three fix candidates in archived 2026-05-10 notes if needed.
- **Macro PNG tileability** — see Small follow-ups above.
- **`useAutoCrop.ts` legacy main-thread** still on disk, not imported. Keep ~1 release as worker regression diff reference, then delete.
- **Smoke test** for editor flow tripped on 200×200 fixture (polygon at default margin filled canvas). Larger fixture or bbox-assert solves it. Not blocking — per-feature specs cover components individually.

### TODO radar
- OpenCV.js version pin (currently `4.x` CDN tag).
- Email backend prod (Gmail SMTP / SES / Mailgun).

---

*Index file. Edit when conventions change or new gotchas surface. AI-only — terse > human-readable.*
