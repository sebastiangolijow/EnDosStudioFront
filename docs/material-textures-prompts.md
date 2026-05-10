# Material reference textures — generation prompt pack

> **Status**: instructions for generating bake-once material reference
> textures via Midjourney / SDXL / FLUX. Drop the resulting PNGs into
> `src/assets/textures/` and the WebGL FX shader (Track 2 integration,
> below) will sample them as a multiply layer on top of its procedural
> gradient. Goal: photoreal premium-vinyl feel without runtime AI cost.

## Why this exists

The procedural shader (`useHolographicFX.ts`) handles per-material color
palettes, highlight patterns, and animation. What it CAN'T do well is
the ultra-fine surface texture of real printed vinyl — the dotted grain
pattern of holographic foil under macro photography, the eggshell paper
fiber, the phosphorescent dust glow on a luminescent print.

A static reference texture, generated once via an image model and baked
into the bundle, gives us those pixel-level details for free.

## Output requirements (all materials)

- **Format**: PNG, RGB (no alpha)
- **Size**: 1024 × 1024
- **Tileability**: yes — texture should tile seamlessly so we can
  repeat it across stickers of any size without visible seams
- **No artwork, no text, no logo, no design** — pure surface texture only
- **Top-down macro view** as if photographed flat
- **Even lighting** — no strong directional shadow, the shader applies
  its own lighting model on top
- **Color**: see per-material specs below

## File destinations

```
src/assets/textures/
├── holografico.png                 ← already exists (pre-AI placeholder)
├── holografico_transparente.png    ← already exists
├── eggshell_holografico.png        ← already exists
├── luminiscente.png                ← already exists
├── holografico_macro.png           ← ⬅ NEW (Track 2 generated)
├── holografico_transparente_macro.png ← ⬅ NEW
├── eggshell_holografico_macro.png  ← ⬅ NEW
└── luminiscente_macro.png          ← ⬅ NEW
```

The `_macro` suffix distinguishes the Track 2 photoreal references from
the existing flat color halo PNGs (which the mask layer uses for the
bleed halo and which we're keeping).

## Per-material prompts

### 1. Holografico (cool foil, opaque)

**Midjourney v6.1**:
```
photorealistic macro photograph of premium holographic vinyl sticker material, iridescent foil surface, cyan magenta gold green color shift, fine dot matrix grain, no text no design, seamless tileable texture, studio lighting, 1024x1024, hyper detailed, square aspect ratio --ar 1:1 --style raw --v 6.1
```

**SDXL / FLUX**:
```
Macro photograph of holographic foil vinyl sticker surface, iridescent rainbow shimmer cyan violet pink gold lime, tiny dotted manufacturing grain, premium quality, seamless tileable, no logo no text, studio softbox lighting, top down, sharp focus, 1024x1024
```

**Negative prompt** (SDXL): `text, logo, design, illustration, character, drawing, watermark, signature, blurry, low quality`

**Acceptance**: should look like a macro shot of a Sticker Mule
holographic background — vivid color shift, dotted texture, no
artistic elements.

---

### 2. Holografico transparente (cool foil, transparent backing)

**Midjourney v6.1**:
```
photorealistic macro photograph of transparent holographic vinyl film, see-through iridescent foil, cyan magenta gold shimmer, fine clear dot grain, transparent base, no text no design, seamless tileable texture, studio lighting, 1024x1024 --ar 1:1 --style raw --v 6.1
```

**SDXL / FLUX**:
```
Macro photograph of transparent holographic film material, clear foil with iridescent rainbow reflection cyan violet pink gold, ultra-thin film, see-through quality, fine grain, premium vinyl, seamless tileable, no logo, studio lighting, top down, 1024x1024
```

**Acceptance**: subtler color depth than the opaque version; the eye
should read "you can see through this."

---

### 3. Eggshell holografico (warm pastel, paper-finish)

**Midjourney v6.1**:
```
photorealistic macro photograph of eggshell paper holographic sticker material, warm cream pastel iridescent finish, soft peach rose lavender mint shimmer, visible paper fiber texture, matte premium paper sticker, no text no design, seamless tileable texture, studio lighting, 1024x1024 --ar 1:1 --style raw --v 6.1
```

**SDXL / FLUX**:
```
Macro photograph of eggshell paper holographic sticker, warm pastel iridescence peach rose lavender cream mint, fine paper fiber grain, matte premium paper finish, slight texture variation, seamless tileable, no logo, studio softbox lighting, top down, 1024x1024
```

**Acceptance**: muted/warm, NOT vivid. Should feel like premium paper
with subtle pearl shimmer, not foil.

---

### 4. Luminiscente (glow-in-the-dark vinyl)

**Midjourney v6.1**:
```
photorealistic macro photograph of glow in the dark vinyl sticker material, phosphorescent yellow-green substrate, faint inner luminescence, fine particle dust glow, slight teal outer ring, no text no design, seamless tileable texture, soft ambient lighting, 1024x1024 --ar 1:1 --style raw --v 6.1
```

**SDXL / FLUX**:
```
Macro photograph of phosphorescent glow-in-the-dark vinyl, yellow-green luminescent surface, fine glowing particle texture, soft inner light emission, premium vinyl finish, seamless tileable, no logo, low ambient light to show glow, top down, 1024x1024
```

**Acceptance**: should look like the material is faintly emitting
light, not just colored green. Particle/dust grain visible.

## Track 2 integration (after textures land)

When the four `_macro.png` files are in `src/assets/textures/`:

### Step A — Bundle them as ESM imports

In `src/utils/materialColors.ts` (the existing single source of truth
for material visuals), add a parallel map of macro-texture URLs:

```ts
import holograficoMacro from '@/assets/textures/holografico_macro.png'
import holograficoTransparenteMacro from '@/assets/textures/holografico_transparente_macro.png'
import eggshellHolograficoMacro from '@/assets/textures/eggshell_holografico_macro.png'
import luminiscenteMacro from '@/assets/textures/luminiscente_macro.png'

export const MATERIAL_MACRO_URLS: Record<Material, string | null> = {
  holografico: holograficoMacro,
  holografico_transparente: holograficoTransparenteMacro,
  eggshell_holografico: eggshellHolograficoMacro,
  luminiscente: luminiscenteMacro,
  // Materials without macro textures fall through to procedural-only.
  vinilo_blanco: null,
  vinilo_transparente: null,
  plateado: null,
  dorado: null,
  eggshell: null,
}
```

### Step B — Add a 3rd texture sampler to the FX shader

In `useHolographicFX.ts` add a new uniform `u_material_texture`
(`sampler2D`) and a `u_has_texture` (`float`, 0 or 1).

In the fragment shader, after `vec3 grad = sample_iridescence(...)`:

```glsl
// Sample the macro texture if available — adds physical surface detail
// (foil dots, paper fiber, glow particles) on top of the procedural
// gradient. Tiles 2x across the artwork so the grain is visible at
// typical sticker zoom levels.
if (u_has_texture > 0.5) {
  vec3 macro_rgb = texture2D(u_material_texture, v_uv * 2.0).rgb;
  // Multiply blend — preserves the procedural color gradient but
  // gates intensity by the macro texture's brightness pattern.
  // Strength of 0.4 means the macro modulates ±40% of the procedural
  // brightness, never fully replacing it.
  grad = grad * mix(vec3(1.0), macro_rgb * 1.5, 0.4);
}
```

### Step C — JS-side texture upload

In `useHolographicFX.ts`'s `setMode`, also upload the macro texture
when one exists for that mode. New helpers:

```ts
const macroTex = shallowRef<WebGLTexture | null>(null)

function uploadMacroTexture(url: string | null) {
  const glx = gl.value
  if (!glx) return
  if (!url) {
    // No texture for this material — flag the shader to skip sampling.
    if (uniforms.value) glx.uniform1f(uniforms.value.u_has_texture!, 0)
    return
  }
  if (!macroTex.value) macroTex.value = glx.createTexture()
  const img = new Image()
  img.onload = () => {
    glx.bindTexture(glx.TEXTURE_2D, macroTex.value)
    glx.texImage2D(glx.TEXTURE_2D, 0, glx.RGB, glx.RGB, glx.UNSIGNED_BYTE, img)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_S, glx.REPEAT)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_T, glx.REPEAT)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MIN_FILTER, glx.LINEAR)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MAG_FILTER, glx.LINEAR)
    if (uniforms.value) glx.uniform1f(uniforms.value.u_has_texture!, 1)
  }
  img.src = url
}
```

`setMode` then calls `uploadMacroTexture(MATERIAL_MACRO_URLS[material])`
before flipping `modeValue`.

### Step D — Bind the texture each frame

In the `frame()` rAF loop, alongside the existing cut/artwork stencil
binds:

```ts
glx.activeTexture(glx.TEXTURE2)
glx.bindTexture(glx.TEXTURE_2D, macroTex.value)
glx.uniform1i(uni.u_material_texture, 2)
```

### Step E — Visual check

For each material, compare WITHOUT macro texture (procedural only)
vs WITH. The macro should add:
- Foil materials: visible dot pattern at moderate zoom
- Eggshell: visible paper fiber grain
- Luminescent: visible glow particle distribution

If a macro texture overpowers the procedural shimmer, drop the `0.4`
mix factor in step B to `0.25`.

## Tuning knobs

Once textures are in, expose these in `useHolographicFX.ts` if needed:

| Knob | What it does |
|---|---|
| Macro mix factor (currently 0.4) | How strongly the texture modulates the procedural color |
| Texture tile count (currently 2x) | Lower = bigger grain, higher = finer |
| Per-material mix override | Some materials might want stronger texture (eggshell paper) and others lighter (transparent foil) |

## Generation workflow

For each prompt:

1. Generate 4 variations (Midjourney `--repeat 4`, or SDXL with 4 seeds)
2. Pick the one most "tileable" (least obvious focal point, even
   distribution of texture)
3. Use a tileable-pass tool (Photoshop "Offset" filter, or
   `python-make-tileable`, or any seamless-texture generator) to fix
   any visible edge seams
4. Save as PNG (JPEG artifacts kill the procedural shader's quality)
5. Drop in `src/assets/textures/` with the `_macro` suffix
6. Commit, and the WebGL shader will pick it up next reload
