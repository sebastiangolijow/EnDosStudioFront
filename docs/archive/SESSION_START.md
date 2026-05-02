# Session Start Briefing — StickerApp Frontend

> **For the AI agent picking this project up.** Read this file first. It captures the work done in the previous session (project setup) and tells you exactly where to start.
>
> If you have time/budget for only one file: read this one, then `CLAUDE.md`, then start working.

---

## 1. What this project is

A Vue 3 single-page app for a Barcelona-based print shop ("gráfica") that sells custom stickers online. End users upload an image, a frontend editor (Canvas + OpenCV.js in the browser) generates a die-cut outline + lets them mark "relief" zones, then they place an order and pay with Stripe.

This is the **frontend** — the Django backend lives in a sibling project (see §7).

Backend's job: store users, orders, files, handle Stripe.
**Frontend's job: every user-visible thing**, including image processing (the backend stores files; it does NOT process pixels).

The app must feel like a "Sticker Lab" — dark, premium, energetic, creative. Not a boring ecommerce form. Brand experience matters here as much as functional correctness.

Built by **YeKo Studio**.

---

## 2. State of the repo right now

The repo currently contains **only** these files:

```
endosstudio_frontend/
├── CLAUDE.md           ← read this NEXT, after this briefing
├── README.md           ← 5-line public description
└── SESSION_START.md    ← you are here
```

There is **no Vue project yet**. No `package.json`, no `src/`, no `node_modules/`. The previous session intentionally stopped before scaffolding so the actual creation could happen with full attention.

**Your first action** is to invoke the `bootstrap-stickerapp-frontend` skill. That skill will lay down all of Phase 1 (Vite + TS + Tailwind + Pinia + 12 routes + 4 stores + 6 UI components + base layout) — see §4 below.

---

## 3. What's already been decided (don't re-litigate)

These are locked answers from the previous session. If you find yourself wanting to revisit any of them, **flag it to the user explicitly** rather than silently changing course — they were debated and chosen for a reason.

| Decision | Value | Why |
|---|---|---|
| Framework | **Vue 3** (Composition API + `<script setup>`) | Studio default, design pack specifies Vue |
| Build tool | **Vite** | Fastest dev experience |
| Language | **TypeScript** | Editor state, OpenCV `Mat` refs, async statuses → TS catches bugs cheap |
| Routing | **Vue Router 4** | Standard |
| State | **Pinia** | Vue 3 default; no Vuex, no Redux |
| Styling | **Tailwind CSS** | Utility-first, design tokens in tailwind.config + tokens.css |
| HTTP | **Axios** | Interceptors for JWT refresh |
| Canvas | **Native Canvas API** + **OpenCV.js via CDN** (loaded async in index.html) | Per design pack §4.8 |
| Drawing | Native Canvas first; **Fabric.js only if drawing complexity justifies it** | YAGNI |
| Tests | **None on day 1** | Phase 1 is structure not behavior; add Vitest when first composable that benefits from a test lands |
| Component library | **None** (no Vuetify / PrimeVue / Element Plus) | Design too custom |
| Animation library | **None** (no GSAP / Framer Motion) | Tailwind transitions cover it |
| Storybook | **None** on day 1 | Add when 10+ in-house components exist |
| Mock backend | **None** | Real backend will be ready when Phase 6 lands |
| Backend project | Sibling repo `EnDosStudioApp` — Django + DRF + JWT + Stripe | Locked from prior session |
| Payments | **Stripe** | Barcelona-based client, EU-friendly |
| Default language | **Spanish** (`<html lang="es">`, copy in es) | Barcelona client |
| Time zone | Europe/Madrid (relevant for date display) | |

---

## 4. Your immediate next action

**Invoke the bootstrap skill.** It's already created and tested-by-design.

```
/bootstrap-stickerapp-frontend
```

(Or just say "scaffold the stickerapp frontend" / "bootstrap the project" / "set up the Vue project" — the skill description triggers on natural-language equivalents.)

The skill is at `~/.claude/skills/bootstrap-stickerapp-frontend/`. Its structure:

```
bootstrap-stickerapp-frontend/
├── SKILL.md                              ← 236 lines: orchestrator, phases, confirmation gate
└── references/
    ├── structure.md                       ← directory tree, index.html, .env.example, .gitignore
    ├── vite-typescript.md                 ← package.json, Vite, TypeScript, ESLint, Prettier
    ├── tailwind-tokens.md                 ← tokens.css + tailwind.config.ts (design tokens locked)
    ├── router-stores.md                   ← 12 routes + 4 Pinia stores + TS types
    ├── services-composables.md            ← Axios + JWT refresh + service stubs + useOpenCV
    ├── ui-components.md                   ← 6 reusable Vue components (AppButton et al.)
    └── layout-views.md                    ← AppShell + AppHeader + DashboardShell + 12 view stubs
```

### What the skill does (so you know what to expect)

- **Phase 1 — read context, build plan, gate.** Reads `CLAUDE.md`, sanity-checks the target dir is empty, verifies Node 18+, then prints the full plan (every directory, every file, every npm package, every env var, every route, every store, every component) and waits for an explicit `yes` before writing.
- **Phase 2 — write files.** Reads each reference file in order and writes the corresponding files. Then runs `npm install` (10–60s).
- **Phase 3 — verify.** `npm run type-check`, `npm run lint`, `npm run build`, `npm run dev` (boot check, then kills the server). Each must pass.
- **Phase 4 — final report.** Prints what was created and the immediate next steps (Phase 2 work: implement HomeView hero, then Login/Register).

### Confirmation gate is non-negotiable

Don't skip the `yes` prompt. The skill writes ~50+ files and runs `npm install`; rolling back is doable but tedious. The gate is the user's last chance to catch anything wrong with the plan.

### After the skill completes

You should have:
- A Vue 3 SPA that boots on `http://localhost:5173/`
- All 12 routes resolve cleanly (clicking around the nav doesn't 404)
- HomeView, LoginView, RegisterView, SetPasswordView are real Phase 1 deliverables
- The other 8 views are placeholders that say which phase implements them
- `npm run type-check` exits clean
- `npm run build` produces a dist/

---

## 5. What comes AFTER the bootstrap (do not do these in the bootstrap)

Once the skeleton exists, the project's first real feature work is **implementing Phase 2 of the design pack** (§4.19): Home, Auth views, Upload flow, basic Order flow. The bootstrap delivers Phase 1 only.

The order of operations for the next phase (after bootstrap, with user input):

1. **Move the design pack into the repo.** It lives at `/Users/cevichesmac/Downloads/Stickerapp Frontend Design Pack.pdf`. Move it to `docs/design-pack.pdf` so future sessions don't depend on the Downloads folder.

2. **Pick a font.** The design pack says "Inter, Satoshi, Manrope or similar". Decide with the user, install via `@fontsource/<font>`, import in `main.ts`. Update `tailwind.config.ts` `fontFamily.sans` if needed.

3. **Implement HomeView fully.** The mockup shows: hero text "Tu diseño. Tu sticker. Sin límites." + primary CTA + ghost CTA + 4-feature row + inspiration gallery. The bootstrap shipped the hero text + CTAs but NOT the gallery, the feature row, or the holographic backdrop visual. That's Phase 2.

4. **Implement the Upload flow.** `UploadDropzone` component (`src/components/upload/UploadDropzone.vue`), drag-drop, file validation (PNG/JPG/JPEG, max 25 MB per the design pack §1.4), client-side dimensions check, push to `sticker.store`, navigate to `/editor/<draftId>`.

5. **Implement OrderConfigView.** Material selector (cards with hover/selected states), size selector, quantity stepper, price summary panel.

6. **Implement CheckoutView (UI only — Stripe integration is Phase 6).** Shipping address form + order summary panel. The "Pay" button will eventually call `ordersService.checkout(orderId)` and hand the `client_secret` to Stripe.js.

7. **Phase 3 starts editor work.** That's a separate, large session — don't sprint into it from Phase 2.

Don't try to do all of this in one session. Each phase is real work.

---

## 6. Pitfalls already paid for (don't re-discover them)

These are gotchas the prior session captured. Inheriting them saves hours.

### OpenCV.js memory leaks

OpenCV `Mat`, `MatVector`, contour objects are **manually managed** — JavaScript GC doesn't free them. Every `.delete()` you skip is a leak that crashes the tab on a long editing session.

Rule: every `cv.imread()`, `new cv.Mat()`, `new cv.MatVector()` MUST be paired with a `.delete()` in a `finally` block. The `useCutDetection` composable (Phase 4) should wrap the algorithm so call sites can't forget.

### OpenCV.js readiness

OpenCV.js loads asynchronously from CDN (~10 MB). **Don't call any `cv.*` function before it's ready.** The `useOpenCV` composable owns this — components must `await waitForOpenCV()` before any cv call. The bootstrap shipped the composable; Phase 4 wires it up.

### Layered canvas architecture

The editor uses **4 separate canvas elements** stacked on top of each other:
1. **Base canvas** — uploaded image
2. **Cut overlay** — detected contour
3. **Relief drawing** — what user paints
4. **Interaction layer** — mouse/touch events

Why: easier to export each layer separately (cut mask, relief mask), easier to toggle overlays, better performance.

### Image size policy

Don't process huge images at full size. A 25 MB PNG will freeze the tab during edge detection.

Rule: keep the original `File` for upload, but downscale to a preview canvas (max 2048×2048) for editing. OpenCV runs against the preview. Backend rescales if needed.

### Async states are explicit

Every async action exposes one of `'idle' | 'loading' | 'success' | 'error'`. The `AsyncStatus` type is in `src/types/api.ts`. UI must reflect every state distinctly — the design pack §1.5 specifies overlay states for the editor (scanner overlay during processing, glow + message after detection, etc.).

### Customer registration creates inactive users

Per the backend's contract: `POST /api/auth/register/` creates `is_active=False`. The user receives an email with a setup link → they hit the frontend's `/set-password?token=...&email=...` page → frontend POSTs to `/api/v1/users/set-password/` → backend activates.

**Frontend must NOT auto-login after registration.** Show "check your email" message and let the user complete the flow via the email link. The bootstrap's `RegisterView.vue` already does this correctly — don't change it.

### `setPassword` URL prefix

The set-password endpoint is at `/api/v1/users/set-password/` (Django's `users.urls`), while everything else uses `/api/auth/...` or `/api/<resource>/`. The bootstrap's `auth.service.ts` hardcodes the path correctly. If the backend ever consolidates URLs, change it in one place.

### JWT refresh deduplication

If 5 concurrent requests get 401 at the same time, naive code fires 5 `/token/refresh/` calls and the last 4 race against the first. The bootstrap's `api.ts` interceptor caches the in-flight refresh promise so all 5 share one wait. Don't break this when you eventually touch the interceptor.

### Tailwind utilities AND CSS variables

Design tokens live in BOTH `src/styles/tokens.css` (CSS variables) AND `tailwind.config.ts` (utilities). Use Tailwind utilities in templates 95% of the time; use CSS variables for SVG attributes or inline styles where utilities don't reach. Keep both in sync.

---

## 7. Reference: backend codebase

`/Users/cevichesmac/Desktop/yeko_studio/endossutdio_backend/` (https://github.com/sebastiangolijow/EnDosStudioApp)

The Django backend is a sibling project. Read its `CLAUDE.md` to understand:
- The full API contract (auth, drafts, orders, admin)
- The User model shape (UUID PK, role: admin/shop_staff/customer)
- The allauth EmailAddress trap and the password-setup flow
- The Stripe integration plan

The backend is greenfield too — when this frontend session runs, the backend may also be unbootstrapped. Don't assume the API is live; in Phase 6 you'll wire to real endpoints, but Phase 1-5 work happens against service stubs only.

When you do hit Phase 6 and the backend doesn't exist yet:
1. Check whether the backend folder has run its bootstrap skill (`ls /Users/cevichesmac/Desktop/yeko_studio/endossutdio_backend/manage.py`).
2. If not, suggest the user bootstrap it before continuing.
3. Once the backend is up at `http://localhost:8000/`, set `VITE_API_BASE_URL=http://localhost:8000/api` in `.env` and you should be talking to it.

---

## 8. The YeKo Studio mindset (load this into your operating frame)

The studio's principles, distilled. Apply them in every architectural decision:

- **Build operational systems for SMBs that already make money.** The bar is "did we reduce real operational chaos and increase real revenue?"
- **Brand experience is part of the product.** This is a creative tool for designers; cold ecommerce-form aesthetics are a regression. Dark, premium, energetic. Holographic accents sparingly.
- **Simple > complex.** Reach for a Vue component before an abstraction. Reach for a composable before a class.
- **Build first, sell after.** Real frontend, not a demo. Every screen should be usable by the end of its phase.
- **Execute, don't theorize.** Ship the obvious answer fast and iterate.
- **Frontend keeps frontend work.** Image processing, masks, previews — all browser. Don't move to backend just because "it's easier on the server".
- **No overengineering.** Don't add a UI library "in case". Don't pre-design abstract base classes. Don't pre-emptively split files.

The 1-line filter: *"If a piece of code doesn't make the user faster or the brand feel better, it isn't worth shipping."*

Full studio context: `/Users/cevichesmac/Desktop/yeko_studio/yeko_studio_context.md`.

---

## 9. Recommended reading order for the next session

If the next session has full token budget:

1. This file (`SESSION_START.md`)
2. `CLAUDE.md` in the same folder
3. The bootstrap skill's `SKILL.md` at `~/.claude/skills/bootstrap-stickerapp-frontend/SKILL.md`
4. The design pack PDF at `/Users/cevichesmac/Downloads/Stickerapp Frontend Design Pack.pdf` (text extracted to `/tmp/stickerapp_design_pack.txt` if PDF reading is unavailable; ask user to install poppler if needed)

That's enough to start. Once the skill runs, it'll pull the relevant references on-demand.

If budget is tight:

1. This file only
2. Then invoke the skill — its own SKILL.md + references handle the rest

---

## 10. What "success" looks like for the next session

You'll know the next session went well if, by the end of it:

- [ ] The bootstrap skill ran end-to-end without errors
- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0 (production build succeeds)
- [ ] `npm run dev` boots on http://localhost:5173/
- [ ] Clicking around the nav resolves all 12 routes (no 404s, no console errors)
- [ ] HomeView shows the hero text + CTAs
- [ ] LoginView, RegisterView, SetPasswordView render cleanly
- [ ] `docs/design-pack.pdf` exists (moved from Downloads)
- [ ] CLAUDE.md updated to mark "bootstrap done" in its status section
- [ ] Initial git commit on the project's repo (already initialized in the prior session)

If you also implemented Phase 2 features in the same session, that's bonus — but bootstrap + verification alone is a complete session.

---

## 11. If something goes wrong

- **The bootstrap skill aborts during the gate** — that's by design. Read what it printed, decide whether to proceed, type `yes` if so.
- **Verification (Phase 3) fails** — stop. Don't fix things mid-flight. Show the user what broke and ask. Common causes: Node version too old, port 5173 in use, network issues fetching npm packages.
- **`npm install` is slow or fails** — likely network. Try again, or check `~/.npmrc` for a misconfigured registry. Don't switch to pnpm/yarn without asking.
- **A TypeScript error appears in a reference-file output** — that means the skill's reference is wrong, not the project. Fix the reference and re-run from the affected step. Surface the issue to the user.
- **The user wants to deviate from a locked decision in §3** — don't silently comply. Surface the trade-off ("changing X means we lose Y; are you sure?") and let them confirm.
- **Backend isn't running when you reach Phase 6** — see §7. Pause Phase 6 work, suggest bootstrapping the backend, return when the API is up.

---

*Created at end of project-setup session. After the next session bootstraps the Vue project, this file becomes historical — feel free to delete it or move it to `docs/archive/SESSION_START.md` once CLAUDE.md is updated to reflect post-bootstrap state.*
