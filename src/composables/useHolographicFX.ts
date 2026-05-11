/**
 * Holographic FX layer — a small WebGL renderer that paints an iridescent
 * shimmer on top of the customer's artwork, clipped to the cut polygon.
 *
 * Why WebGL (not 2D canvas):
 *   The "screen blend + linear gradient" approach used by the 2D path is
 *   flat — the gradient angle never changes, the colors are static, and
 *   the bleed ring just shows the mask palette's tint. Real holographic
 *   vinyl looks alive: the colors shift across the surface, periodic
 *   highlight bands sweep across, and the iridescence has a noise-warped
 *   organic feel. None of that is reachable with `globalCompositeOperation`.
 *
 *   A fragment shader can compute color per-pixel as a function of
 *   (uv, time, mouse) → so we get smooth iridescence + animated shimmer
 *   on every modern device's GPU at 60 fps.
 *
 * Architecture:
 *   - Owns ONE WebGL canvas that lives between the mask layer (halo) and
 *     the base layer (artwork) in the canvas stack. The canvas is
 *     transparent everywhere except inside the cut polygon, where it
 *     paints the holographic effect.
 *   - The base 2D canvas keeps drawing the artwork as before — the FX
 *     layer just adds the iridescent overlay using the alpha channel of
 *     the cut polygon as a mask.
 *   - When the material is non-holographic, the FX canvas's display is
 *     toggled off and no rendering happens.
 *
 * Uniforms:
 *   - u_time: monotonic seconds since mount, drives shimmer animation
 *   - u_mouse: cursor x/y in 0..1 normalized canvas coords (animated tilt)
 *   - u_cut_polygon / u_artwork_polygon: NOT passed as polygons — we
 *     pre-rasterize them to two single-channel "stencil" textures so the
 *     fragment shader can sample alpha cheaply. This is much faster than
 *     evaluating point-in-polygon in the shader for 600+ vertices.
 *   - u_resolution: canvas size in CSS pixels
 *   - u_intensity: 0..1, drops to 0 for "off" so a watch can fade the
 *     effect in/out smoothly when the customer picks a different material
 *
 * Lifecycle:
 *   The composable owns the rAF loop, GL program, textures, and uniforms.
 *   Consumer wires the canvas ref to a <canvas> in the template, calls
 *   setEnabled / setPolygons / setSize as the editor state changes.
 *   onBeforeUnmount frees the GL context.
 */
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import type { ImagePoint } from './useAutoCrop'
import { smoothPolygonPerimeter } from '@/utils/polygon'
import { MATERIAL_MACRO_URLS } from '@/utils/materialColors'

/**
 * Map FX modes to the Material enum identifier used by MATERIAL_MACRO_URLS.
 * (The JS-side mode names use English; the catalog's Material enum is the
 * Spanish snake_case version. Single source of mapping kept here so callers
 * don't have to know both.)
 */
const MODE_TO_MATERIAL = {
  holographic: 'holografico',
  holographic_transparent: 'holografico_transparente',
  eggshell_holographic: 'eggshell_holografico',
  luminescent: 'luminiscente',
} as const

/**
 * Per-mode strength of the macro-texture modulation. Foil materials
 * benefit most from the texture (the dot grain IS their signature
 * look); eggshell uses moderate strength so the paper fiber grain reads
 * subtle; luminescent uses low strength because we want the glow to
 * dominate, not the particle texture.
 */
const TEXTURE_STRENGTH_BY_MODE: Record<string, number> = {
  holographic: 0.45,
  holographic_transparent: 0.40,
  eggshell_holographic: 0.30,
  luminescent: 0.20,
}

const VERTEX_SHADER = `#version 100
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  // Flip Y so v_uv.y == 0 is top of canvas (matches stencil textures).
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 100
precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_cut_stencil;
uniform sampler2D u_artwork_stencil;
// Optional macro reference texture for the active material. When present,
// modulates the procedural color with photoreal material grain (foil dots,
// paper fiber, glow particles). u_has_texture toggles the sampling — when
// 0, the shader skips the texture2D call so it works fine even when the
// PNG asset hasn't been generated yet.
uniform sampler2D u_material_texture;
uniform float u_has_texture;     // 0 = procedural only, 1 = sample texture
uniform float u_texture_strength; // per-material multiply factor 0..1
// Snapshot of the base 2D canvas (artwork + smart-cut bleed background).
// Sampled in the bleed branch so the iridescence TINTS the underlying
// color (e.g. a teal bleed reads as teal-with-shimmer, not rainbow
// paint). When no snapshot has been uploaded yet (early frames before
// the image loads, or modes that don't need it), u_has_base flips off
// and the bleed branch falls back to the legacy gradient overlay so
// nothing flashes black.
uniform sampler2D u_base_tex;
uniform float u_has_base;        // 0 = no snapshot yet, 1 = sample base
uniform float u_time;        // seconds since mount
uniform vec2  u_mouse;       // 0..1, (0.5,0.5) = center
uniform float u_intensity;   // 0..1, fade in/out
// Mode selector:
//   1.0 = holographic (opaque)
//   2.0 = holographic transparent (drops alpha over artwork interior so
//          the canvas checker reads through, matching vinilo_transparente)
//   3.0 = luminescent (solid greenish-yellow glow, no iridescence)
//   4.0 = eggshell holographic (warm pastel, soft diffuse foil)
// Sub-1 values noop the shader (the host fades intensity to 0).
uniform float u_mode;

// === Iridescent palette ===
// 5-stop palette, same hex stops as the bundled holografico.png texture
// so the WebGL shimmer reads as the same material as the bleed halo.
// Full saturation — real holographic foil reflects vivid color zones
// (the "tilt and see green / teal / pink shift through" effect on a
// physical sticker), not pastel rainbow paint. The previous
// desaturation toward white made the result look like watercolor.
const vec3 WHITE = vec3(1.0);

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// Each material has its own palette — what makes "holografico" feel
// different from "eggshell holografico" beyond shader parameters is
// the COLOR vocabulary. Real holographic foil cycles through the cool
// neon side of the spectrum (cyan/violet/magenta/gold). Eggshell foil
// — printed on a warm cream/off-white substrate — cycles through more
// muted pastel tones (peach/rose/lavender/cream).
//
// Caller picks via u_palette uniform: 0 = cool foil, 1 = warm pastel.
vec3 iridescence_cool(float t) {
  t = fract(t);
  vec3 cyan   = vec3(0.133, 0.827, 0.933);  // #22D3EE
  vec3 violet = vec3(0.659, 0.333, 0.969);  // #A855F7
  vec3 pink   = vec3(0.957, 0.447, 0.714);  // #F472B6
  vec3 gold   = vec3(0.980, 0.800, 0.082);  // #FACC15
  vec3 lime   = vec3(0.639, 0.902, 0.208);  // #A3E635
  if (t < 0.25)      return mix(cyan,   violet, t * 4.0);
  else if (t < 0.5)  return mix(violet, pink,   (t - 0.25) * 4.0);
  else if (t < 0.75) return mix(pink,   gold,   (t - 0.5) * 4.0);
  else               return mix(gold,   lime,   (t - 0.75) * 4.0);
}

// Eggshell holographic palette — warm pastels. Reads as a softer,
// premium-paper-printed foil; muted enough that the base eggshell
// texture (in the bleed halo) still dominates, with the foil only
// providing subtle iridescence where light catches it.
vec3 iridescence_warm(float t) {
  t = fract(t);
  vec3 peach   = vec3(1.000, 0.847, 0.690);  // soft peach
  vec3 rose    = vec3(0.973, 0.682, 0.690);  // dusty rose
  vec3 lavender= vec3(0.831, 0.737, 0.945);  // pale lavender
  vec3 cream   = vec3(0.984, 0.918, 0.812);  // warm cream
  vec3 mint    = vec3(0.792, 0.945, 0.882);  // pale mint
  if (t < 0.25)      return mix(peach,    rose,     t * 4.0);
  else if (t < 0.5)  return mix(rose,     lavender, (t - 0.25) * 4.0);
  else if (t < 0.75) return mix(lavender, cream,    (t - 0.5) * 4.0);
  else               return mix(cream,    mint,     (t - 0.75) * 4.0);
}

// === Holographic mode ===
//
// Mental model: a CLEAR LACQUER COATING on top of opaque printed ink.
// The ink layer (the customer's artwork) is below us, fully solid. The
// lacquer is mostly transparent — only visible where light reflects
// off it. Our shader's job is to compute "where would highlights fall"
// and write iridescent color ONLY in those regions, with alpha=0
// everywhere else over the artwork. The bleed area has no ink below,
// so it gets the full holographic field at high alpha.
//
// What changed from the previous version:
//   - NO more uniform-alpha overlay across the artwork interior.
//     Previous version + screen-blend universally washed out the
//     artwork — saturation and blacks both lost to the overlay.
//   - Highlight pattern drives artwork alpha. Most artwork pixels:
//     alpha = 0 → artwork shows through fully intact. Specular
//     highlights: visible iridescent reflection at moderate alpha.
//   - Standard alpha blending (no mix-blend-mode trickery). The host
//     canvas paints over the artwork normally; transparent FX pixels
//     leave the artwork unchanged.
//
// Effect inputs:
//   - Iridescent gradient (5-stop, vivid) — the color of the foil
//   - Mouse-anchored sheen — a bright spot at the cursor (where the
//     simulated "light source" is hitting)
//   - Sweep band pattern — a few thin parallel iridescent bands across
//     the surface, like the streaks you see on real holographic foil
//     when you tilt it. THIS is what defines the "highlight regions"
//     — outside these bands, the artwork has alpha=0 protection.
//   - Edge bloom — a soft glow JUST INSIDE the cut polygon boundary
// Per-material parameter struct — picked from a switch on u_mode in
// main(). Centralizes the differences between holografico,
// holografico_transparente, eggshell_holografico in one place so it's
// obvious WHAT changes between materials (palette, band sharpness,
// hotspot focus, max alpha).
struct MaterialParams {
  // 0 = cool palette (cyan/violet/pink/gold/lime), 1 = warm pastel
  int   palette_id;
  // Diagonal band sharpness. Lower = softer/wider bands (eggshell);
  // higher = sharper/tighter bands (foil).
  float band_sharpness_1;
  float band_sharpness_2;
  float band_sharpness_3;
  // Hotspot focus exponent. Higher = tighter hot spot at the mouse.
  // Lower = broader spread.
  float hotspot_focus;
  // How strongly the substrate's iridescence modulates the printed
  // ink. Foil = strong (0.45 — the customer's purple gets a visible
  // holographic tilt). Eggshell = mild (0.20 — paper foil only adds
  // a faint warm sheen to the ink).
  float ink_substrate_blend;
  // Highlight color blend toward white. Foil = vivid (low blend, ~0.5);
  // eggshell = soft (more white, ~0.8); makes the bands read like soft
  // diffused sheen instead of crisp specular.
  float highlight_white_mix;
  // Overall alpha ceiling for the FX paint over BARE substrate (density=0
  // regions: bleed ring + transparent edge pixels). Foil = high (0.95),
  // eggshell = lower (0.55) so its halo PNG character shows through.
  float substrate_alpha;
};

vec3 sample_iridescence(int palette_id, float t) {
  if (palette_id == 1) return iridescence_warm(t);
  return iridescence_cool(t);
}

// Apply the optional macro-texture modulation. When u_has_texture is 0
// the input color passes through unchanged (the shader still works
// without any baked PNG present — important for graceful no-op when
// the AI-generated assets haven't landed yet).
//
// The texture tiles 2× across the surface so individual grain elements
// are visible at typical sticker zoom levels. Multiply blend preserves
// the procedural gradient hue but brightness-modulates by the texture
// — bright spots in the macro make the procedural color brighter
// there; dark spots dim it. Strength is per-material: foil materials
// want stronger texture (the dot pattern is the signature look),
// eggshell wants moderate (paper fiber should be subtle), luminescent
// wants subtle (we want the glow to dominate, not the particle grain).
vec3 apply_macro_texture(vec3 color, float strength) {
  if (u_has_texture < 0.5) return color;
  vec3 macro_rgb = texture2D(u_material_texture, v_uv * 2.0).rgb;
  // Multiply blend, gated by strength. mix(1.0, macro_rgb*1.5, strength)
  // means at strength=0 we pass the original color; at strength=1 we
  // multiply by macro_rgb × 1.5 (the 1.5 prevents the texture from
  // darkening the gradient too much — texture brightness centered
  // around 0.5-0.7 in a typical material PNG, ×1.5 ≈ 0.75-1.0).
  return color * mix(vec3(1.0), macro_rgb * 1.5, strength);
}

vec4 mode_holographic_with_params(
  float in_cut,
  float in_artwork,
  MaterialParams p
) {
  // Iridescent gradient parameter. Mouse drives the phase shift —
  // moving the cursor slides which colors are visible across the
  // sticker. Three-octave noise warp (was two) gives sharper, more
  // organic color boundaries — readable rainbow separation instead
  // of smooth pastel diagonals. The hash term at the highest octave
  // adds a fine sparkle/dithering on the color separation.
  float n1 = noise(v_uv * 3.5) * 0.28;
  float n2 = noise(v_uv * 11.0) * 0.12;
  float n3 = noise(v_uv * 28.0) * 0.05;
  float warp = n1 + n2 + n3;
  float diag = (v_uv.x + v_uv.y) * 0.5;
  float phase = (u_mouse.x - 0.5) * 1.5 + (u_mouse.y - 0.5) * 0.8;
  float t = diag + warp + phase;
  vec3 grad = sample_iridescence(p.palette_id, t);
  // Boost gradient saturation toward primary stops — pushes mid-mix
  // pastels back toward vivid cyan/magenta/gold so the rainbow reads
  // as "spectral light" rather than "watercolor". Power curve on each
  // channel deepens the saturation without shifting hue.
  float grad_max = max(max(grad.r, grad.g), grad.b);
  float grad_min = min(min(grad.r, grad.g), grad.b);
  float grad_lum = (grad_max + grad_min) * 0.5;
  // Saturate: pull each channel away from grayscale luminance by 25%.
  grad = grad_lum + (grad - vec3(grad_lum)) * 1.25;
  grad = clamp(grad, 0.0, 1.0);
  // Modulate by the macro texture (foil dot / paper fiber grain) at
  // u_texture_strength. No-op when no macro PNG is bundled.
  grad = apply_macro_texture(grad, u_texture_strength);

  // === Specular highlight pattern ===
  //
  // Real holographic vinyl shows TWO scales of optical response:
  //   - Broad iridescent zones (the diagonal sweep bands)
  //   - Fine high-frequency sparkle (the diffraction grain catching
  //     light at many sub-pixel angles)
  // The previous version only had the broad bands. Adding a 4th
  // high-frequency band PLUS a fine-grain sparkle term gives the
  // material the "live optical surface" character — not flat-tinted
  // plastic.
  //
  // Bands are SHARPER (×1.6 sharpness multiplier) and brighter
  // (amplitudes summed to >1.0 before clamp) so the streaks snap into
  // crisp light rather than diffuse haze. Combined with stronger
  // white-peak mixing downstream, this is what makes the rainbow
  // bands actually read as spectral reflections.

  // Hot spot at the mouse position. p.hotspot_focus controls the
  // tightness — foil = sharp small spot, eggshell = broader softer spot.
  vec2 mouse_pos = vec2(u_mouse.x, u_mouse.y);
  float mouse_dist = distance(v_uv, mouse_pos);
  float hotspot = exp(-mouse_dist * mouse_dist * p.hotspot_focus);

  // Diagonal sweep bands — narrow streaks across the surface. Four
  // bands at staggered frequencies (was three). The 4th is high-
  // frequency and tight — the "fine sparkle" that fixes the "too
  // smooth and uniform" gradient complaint.
  float band_axis = v_uv.x * 1.2 - v_uv.y * 0.6 + (u_mouse.x - 0.5) * 0.3;
  float b1 = exp(-pow(fract(band_axis * 1.4 + 0.10) - 0.5, 2.0) * p.band_sharpness_1 * 1.6);
  float b2 = exp(-pow(fract(band_axis * 2.1 + 0.55) - 0.5, 2.0) * p.band_sharpness_2 * 1.6);
  float b3 = exp(-pow(fract(band_axis * 3.0 + 0.85) - 0.5, 2.0) * p.band_sharpness_3 * 1.6);
  float b4 = exp(-pow(fract(band_axis * 5.5 + 0.30) - 0.5, 2.0) * p.band_sharpness_1 * 2.8);
  float bands = b1 * 0.85 + b2 * 0.65 + b3 * 0.45 + b4 * 0.35;

  // Diffraction sparkle — high-frequency hash dithered by the bands.
  // Pixel-scale optical noise that reads as the foil's micro-grating
  // catching light at random sub-angles. Multiplied by bands so it
  // only fires INSIDE the streak zones — not a uniform sparkle field
  // (which would look like TV static), but sparkle THAT FOLLOWS the
  // band sweep (which reads as physical diffraction).
  float sparkle = (hash(v_uv * 320.0 + u_mouse * 4.0) - 0.5) * 0.6;
  sparkle = sparkle * smoothstep(0.2, 0.8, bands);

  // Combined highlight mask. Bands × hotspot focuses reflection energy
  // near the cursor — matches real specular behavior. Sparkle is added
  // OUTSIDE the clamp so it can briefly punch above 1.0, producing
  // crisp white pinpoint reflections inside the band streaks.
  float highlight = clamp(bands * (0.45 + hotspot * 1.10), 0.0, 1.2);
  highlight += sparkle * hotspot;
  highlight = clamp(highlight, 0.0, 1.4);

  // Soft cut-edge bloom — thin diffused-light band just inside the
  // polygon boundary. Adds a subtle inner-rim glow that fuses the
  // contour into the substrate.
  float edge_bloom = smoothstep(0.0, 0.45, in_cut)
                   * (1.0 - smoothstep(0.45, 1.0, in_cut));

  // === UNIFIED SUBSTRATE MODEL ===
  //
  // The whole interior of the cut polygon is ONE physical material:
  // holographic vinyl. The customer's artwork is INK PRINTED on that
  // vinyl. So every pixel inside the cut is composed as:
  //
  //   final = ink × ink_density   +   substrate × (1 - ink_density)
  //
  // …with shared shimmer/specular response across both terms so the
  // sticker reads as a single material, not "artwork PNG on top of
  // holographic paper".
  //
  // Why this matters: the old branch model painted ink_density=1 over
  // the artwork interior and ink_density=0 over the bleed, with a
  // hard transition at the silhouette. Anti-aliased fur-edge pixels
  // (alpha ≈ 0.4) were classified as artwork → original matte color
  // preserved → visible "PNG cutout" halo. The new model lets those
  // edge pixels FUSE into the substrate because their density is
  // low → they pick up substrate color in proportion to (1 - density).

  vec3 substrate = grad;

  // Macro texture modulation moved here so it modulates the substrate
  // (not split between branches as before). Foil dot grain / paper
  // fiber / glow particles appear across the whole sticker.
  substrate = apply_macro_texture(substrate, u_texture_strength);

  // Substrate response — strong reflective behavior. Bare vinyl is
  // where the rainbow has to LIVE; this is the "specular reflected
  // light" surface the customer reads as holographic foil.
  //
  // Two-stage brightening:
  //   1. Mix toward WHITE at high gain (0.9 vs old 0.55) — the streaks
  //      blow out toward pure light at peaks, like real foil catching
  //      a directional reflection.
  //   2. ADDITIVE iridescent bloom — adds the gradient color back ON
  //      TOP of the highlight. This is what makes the rainbow visibly
  //      separate (cyan / magenta / gold reads as distinct hues at
  //      the streak, not a uniform pastel sheen).
  // Stronger per-pixel grain (0.10 vs 0.06) plus an extra fine-grain
  // sparkle term so the surface reads as live optical material.
  vec3 substrate_color = mix(substrate, WHITE, clamp(highlight * 0.90, 0.0, 1.0));
  substrate_color += grad * clamp(highlight * 0.55, 0.0, 1.0);
  float grain_mul = 1.0 + (hash(v_uv * 800.0) - 0.5) * 0.10;
  substrate_color *= grain_mul;
  substrate_color += vec3(edge_bloom) * 0.14;
  // Clamp to keep us in HDR-friendly range (the FX is composited over
  // the page so >1.0 RGB would just clip — better to cap explicitly).
  substrate_color = clamp(substrate_color, 0.0, 1.0);

  // Sample the printed ink. The base canvas holds the customer's artwork
  // (plus the smart-cut bleed pixels in the surrounding ring). u_has_base
  // gates whether we have a real snapshot yet — pre-load frames fall
  // back to ink_density=0 → pure substrate everywhere.
  vec4 base_sample = texture2D(u_base_tex, v_uv);
  vec3 base_rgb = base_sample.rgb;
  float base_alpha = base_sample.a * u_has_base;

  // === Ink density ===
  //
  // "How much pigment covers the vinyl here?" Drives everything:
  //   - density 0 → pure substrate (bleed, transparent gaps)
  //   - density 1 → mostly ink, substrate only catches specular highlights
  //   - density 0.3..0.7 → THE INTERESTING RANGE — anti-aliased fur edges,
  //     semi-transparent strokes, halftones. These pixels fuse into the
  //     substrate visibly, killing the matte-halo "PNG cutout" look.
  //
  // Driven mostly by base alpha (transparency = no ink); slightly
  // reduced for very bright pixels so specular punches through bright
  // ink at highlight zones. Saturated colors (purple fur, cyan eyes)
  // stay near density 1 — the customer's color choices are preserved.
  float base_brightness = dot(base_rgb, vec3(0.299, 0.587, 0.114));
  float ink_density = base_alpha * (1.0 - base_brightness * 0.25);
  ink_density = clamp(ink_density, 0.0, 1.0);

  // === Ink response to substrate ===
  //
  // Ink isn't independent of the laminate — real holographic printing
  // tints the pigment too. Cool foil substrate × purple ink = purple
  // with cyan/green tilt under the cursor (matches the reference).
  // p.ink_substrate_blend controls how strong this is per material.
  vec3 ink_color = base_rgb;
  ink_color = mix(ink_color, ink_color * substrate * 1.6, p.ink_substrate_blend);
  // ADDITIVE iridescent specular on the ink side. Previous version did
  // mix(ink, WHITE, highlight) which dimmed contrast on dark pixels —
  // black outlines got grayed instead of getting a bright colored
  // gleam. Additive grad×highlight paints the rainbow LIGHT on top of
  // the pigment: blacks stay black at the base, but at highlight zones
  // they pick up vivid cyan/magenta/gold streaks. This is the
  // "spectral reflected light, not color tinting" behavior the
  // reference shows on the gorilla's black outlines.
  //
  // The strength factor combines per-material highlight_white_mix
  // (foil sharp, eggshell soft) with a global gain. The result is
  // capped because pure additive on bright ink could over-saturate;
  // the min(ink + bloom, ink + WHITE*highlight*0.8) keeps very bright
  // pixels from blowing past white.
  vec3 ink_bloom = grad * clamp(highlight * p.highlight_white_mix * 0.95, 0.0, 1.2);
  // Sparkle pinpoints — when the high-frequency sparkle fires on ink,
  // add a near-white pulse on top of the colored bloom. These are the
  // "tiny flashes" of real diffraction grating reflections.
  ink_bloom += vec3(clamp(sparkle * 1.2, 0.0, 1.0));
  ink_color = ink_color + ink_bloom;
  // Clamp so the additive can't push outside the displayable range.
  ink_color = clamp(ink_color, 0.0, 1.0);

  // === Composition ===
  vec3 rgb = mix(substrate_color, ink_color, ink_density);

  // Alpha: bare substrate dominates the bleed; heavy ink mostly lets
  // the base canvas's artwork through (we only contribute specular).
  // Highlight boost is BIGGER now (0.35 vs 0.22) so the additive
  // specular has alpha visibility on dark ink — that's what makes the
  // rainbow streaks pop on the gorilla's blacks.
  float alpha = mix(p.substrate_alpha, 0.18, ink_density) + highlight * 0.35;
  alpha = clamp(alpha, 0.0, 0.98);

  // Mask by in_cut so the FX layer's footprint is exactly the sticker.
  return vec4(rgb, alpha * in_cut);
}

// === Per-material parameter presets ===
//
// Each material gets distinct shader behavior so the customer sees a
// real difference picking holografico vs holografico_transparente vs
// eggshell_holografico. The parameter ranges were tuned by reading
// what the previous unified shader did and adjusting in directions
// that match each material's physical character.

MaterialParams params_holografico() {
  // Cool foil — vivid neon palette, sharp tight bands, focused hot spot.
  // Substrate dominates the bleed (high substrate_alpha) and tilts the
  // ink visibly (moderate ink_substrate_blend).
  return MaterialParams(
    0,        // palette_id: cool
    80.0,     // band_sharpness_1
    120.0,    // band_sharpness_2
    160.0,    // band_sharpness_3
    8.0,      // hotspot_focus (tight)
    0.45,     // ink_substrate_blend (purples get visible foil tilt)
    0.7,      // highlight_white_mix
    0.95      // substrate_alpha (bleed reads as pure foil)
  );
}

MaterialParams params_holografico_transparente() {
  // Same cool palette + sharp bands. The "transparent" character now
  // shows in TWO ways: substrate_alpha slightly lower so the canvas
  // checker reads through bare regions; ink_substrate_blend higher so
  // ink picks up more substrate character (no opaque backing to mask it).
  return MaterialParams(
    0,        // palette_id: cool
    100.0,    // band_sharpness_1 (tighter "thin clear film")
    140.0,    // band_sharpness_2
    180.0,    // band_sharpness_3
    6.0,      // hotspot_focus
    0.60,     // ink_substrate_blend (stronger — no opaque vinyl)
    0.85,     // highlight_white_mix (brighter peaks)
    0.82      // substrate_alpha (lower — checker reads through bare areas)
  );
}

MaterialParams params_eggshell_holografico() {
  // Warm pastel palette, broad SOFT bands, broad hotspot. Eggshell paper
  // is the dominant character — the foil only adds a faint warm sheen,
  // so ink_substrate_blend is low (artwork stays close to its source
  // colors) and substrate_alpha is moderate (the cream PNG halo in the
  // mask layer reads through).
  return MaterialParams(
    1,        // palette_id: warm
    25.0,     // band_sharpness_1 (soft/broad)
    35.0,     // band_sharpness_2
    50.0,     // band_sharpness_3
    4.0,      // hotspot_focus (broad)
    0.20,     // ink_substrate_blend (mild — paper foil is subtle)
    0.5,      // highlight_white_mix (soft pastel sheen)
    0.55      // substrate_alpha (lower so eggshell texture halo dominates)
  );
}

// === Luminescent mode (unified substrate model) ===
//
// Glow-in-the-dark vinyl. Same architecture as holographic: the entire
// cut polygon is ONE material. Printed ink absorbs the glow; bare
// vinyl glows. Anti-aliased edges fuse into the substrate via ink
// density, killing the "PNG cutout" matte halo.
//
// Differences from holographic:
//   - Phosphorescent palette (yellow-green / teal) — no diagonal bands
//   - Slow autonomous pulse driven by u_time (the material literally
//     pulses in real life)
//   - Mouse hotspot only — no specular highlight streaks (glow vinyl
//     doesn't reflect light, it EMITS it)
//   - Edge band — luminance leaks INWARD from the cut boundary, a
//     diagnostic signal that "this material glows"
vec4 mode_luminescent(float in_cut, float in_artwork) {
  // Slow autonomous pulse — 0.92..1.00 over a ~3s cycle.
  float pulse = 0.92 + 0.08 * sin(u_time * 2.1);

  // Phosphorescent palette — bright yellow-green with a teal cool tone.
  vec3 inner_glow = vec3(0.70, 1.00, 0.40);
  vec3 outer_glow = vec3(0.50, 0.95, 0.85);

  // Mouse-anchored hot spot — broad, soft.
  vec2 mouse_pos = vec2(u_mouse.x, u_mouse.y);
  float mouse_dist = distance(v_uv, mouse_pos);
  float hotspot = exp(-mouse_dist * mouse_dist * 5.0);

  // Edge band — luminance leaking inward from the cut boundary.
  float edge_band = smoothstep(0.0, 0.6, in_cut)
                  * (1.0 - smoothstep(0.6, 1.0, in_cut));

  // Sample the printed ink — same as holographic path.
  vec4 base_sample = texture2D(u_base_tex, v_uv);
  vec3 base_rgb = base_sample.rgb;
  float base_alpha = base_sample.a * u_has_base;
  float base_brightness = dot(base_rgb, vec3(0.299, 0.587, 0.114));
  float ink_density = base_alpha * (1.0 - base_brightness * 0.25);
  ink_density = clamp(ink_density, 0.0, 1.0);

  // Substrate — the glow itself. Varies inner/outer based on whether
  // we're near the cut edge (cooler teal at the boundary; brighter
  // yellow-green deep inside, like real glow vinyl where the glow
  // accumulates in the bulk). edge_band is high at the boundary, low
  // in the bulk — so we mix the other way: inner deep, outer at edge.
  float boundary_ness = clamp(edge_band, 0.0, 1.0);
  vec3 substrate = mix(inner_glow, outer_glow, boundary_ness) * pulse;
  substrate = apply_macro_texture(substrate, u_texture_strength);

  // Substrate brightening near the mouse hotspot (the "fresh-charged"
  // bright region near the cursor).
  vec3 substrate_color = substrate + vec3(hotspot * 0.20);
  // Extra bloom at the cut edge — the visible "phosphorescent rim".
  substrate_color += vec3(edge_band * 0.18);

  // Ink response — glow vinyl tints the printed ink slightly with its
  // own color (a green-tinted version of the customer's pigment is
  // what you'd see under UV). Low blend factor — mostly the artwork
  // shows through.
  vec3 ink_color = mix(base_rgb, base_rgb * substrate * 1.5, 0.15);
  // Ink near the cut edge picks up a small edge-glow boost — sells the
  // "the glow leaks past the ink at the silhouette" feel.
  ink_color += vec3(edge_band * 0.10);

  vec3 rgb = mix(substrate_color, ink_color, ink_density);

  // Alpha: bleed solid glow; ink mostly transparent so the base canvas
  // artwork shows through; small boost at edges/hotspot for the visible
  // glow leak.
  float alpha = mix(0.85, 0.18, ink_density) + edge_band * 0.20 + hotspot * 0.08;
  alpha = clamp(alpha, 0.0, 0.95);

  return vec4(rgb, alpha * in_cut);
}

void main() {
  float in_cut     = texture2D(u_cut_stencil, v_uv).r;
  float in_artwork = texture2D(u_artwork_stencil, v_uv).r;

  if (in_cut < 0.01) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // Dispatch by mode.
  //   1 = holografico (cool foil)
  //   2 = holografico_transparente (cool foil, stronger over artwork)
  //   3 = luminescent
  //   4 = eggshell_holografico (warm pastel, soft diffuse foil)
  vec4 col;
  if (u_mode > 3.5) {
    col = mode_holographic_with_params(in_cut, in_artwork, params_eggshell_holografico());
  } else if (u_mode > 2.5) {
    col = mode_luminescent(in_cut, in_artwork);
  } else if (u_mode > 1.5) {
    col = mode_holographic_with_params(in_cut, in_artwork, params_holografico_transparente());
  } else if (u_mode > 0.5) {
    col = mode_holographic_with_params(in_cut, in_artwork, params_holografico());
  } else {
    col = vec4(0.0);
  }

  gl_FragColor = vec4(col.rgb * u_intensity, col.a * u_intensity);
}
`

interface PolygonStencilSource {
  /** Cut polygon in image-natural pixels. */
  cut: ImagePoint[]
  /** Tight artwork polygon in image-natural pixels. May be null/equal to
   *  the cut polygon, in which case the artwork stencil == cut stencil
   *  and the shader paints the whole interior at "bleed" intensity. */
  artwork: ImagePoint[] | null
  /** Image natural width — used to map polygon pixel coords to UV. */
  imageWidth: number
  imageHeight: number
  /** Drawn fit transform — needed to align stencil with the canvas. */
  fit: { offsetX: number; offsetY: number; drawW: number; drawH: number }
  /** Number of perimeter-Gaussian iterations to apply before rasterizing.
   *  MUST match what the base canvas's `drawBaseLayer` does, otherwise the
   *  FX boundary visibly misaligns with the clipped artwork edge —
   *  iridescent fringe leaks past the cut line and the artwork's raw
   *  pixel-stair edges poke through the FX layer. The base canvas reads
   *  this from the customer's "Suavidad" slider. */
  smoothingIterations: number
}

/**
 * Trace a closed contour as a smooth quadratic-curve path on a 2D ctx.
 * Mirrors useCanvasEditor's `traceSmoothClosedCurve` so the stencil
 * boundary matches the base canvas's clip path exactly. Keeping a copy
 * here (rather than importing the editor composable) keeps the FX
 * composable free of the editor's lifecycle dependencies.
 */
function traceSmoothClosedCurve(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  points: { x: number; y: number }[],
) {
  const n = points.length
  if (n < 3) {
    if (n > 0) ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < n; i++) ctx.lineTo(points[i].x, points[i].y)
    return
  }
  const startMidX = (points[n - 1].x + points[0].x) / 2
  const startMidY = (points[n - 1].y + points[0].y) / 2
  ctx.moveTo(startMidX, startMidY)
  for (let i = 0; i < n; i++) {
    const cp = points[i]
    const next = points[(i + 1) % n]
    const midX = (cp.x + next.x) / 2
    const midY = (cp.y + next.y) / 2
    ctx.quadraticCurveTo(cp.x, cp.y, midX, midY)
  }
}

export function useHolographicFX() {
  const canvas = ref<HTMLCanvasElement | null>(null)
  const enabled = ref(false)

  const gl = shallowRef<WebGLRenderingContext | null>(null)
  const program = shallowRef<WebGLProgram | null>(null)

  // Uniform locations cached after compile.
  const uniforms = shallowRef<{
    u_cut_stencil: WebGLUniformLocation | null
    u_artwork_stencil: WebGLUniformLocation | null
    u_material_texture: WebGLUniformLocation | null
    u_has_texture: WebGLUniformLocation | null
    u_texture_strength: WebGLUniformLocation | null
    u_base_tex: WebGLUniformLocation | null
    u_has_base: WebGLUniformLocation | null
    u_time: WebGLUniformLocation | null
    u_mouse: WebGLUniformLocation | null
    u_intensity: WebGLUniformLocation | null
    u_mode: WebGLUniformLocation | null
  } | null>(null)

  const cutTex = shallowRef<WebGLTexture | null>(null)
  const artworkTex = shallowRef<WebGLTexture | null>(null)
  // Snapshot of the base 2D canvas — sampled in the shader's bleed branch
  // so the foil tint preserves the underlying color (e.g. teal-with-shimmer
  // instead of rainbow-over-teal). Re-uploaded by the host (CanvasStage)
  // whenever the base canvas redraws — same triggers that already rebuild
  // the polygon stencils, plus a microtask delay so the host's
  // `drawBaseLayer` finishes first.
  const baseTex = shallowRef<WebGLTexture | null>(null)
  let hasBase = 0
  // Macro reference texture for the active material. Replaced whenever
  // setMode picks a material with a bundled macro PNG. `hasTexture` is
  // the JS mirror of the u_has_texture uniform — drives both the bind
  // call and the shader's branch (skip texture2D when 0).
  const macroTex = shallowRef<WebGLTexture | null>(null)
  // Cache loaded macro Image elements per Material so repeat picks
  // don't re-fetch. The cache is keyed by the URL string (not the
  // Material enum) since some materials might not have a macro PNG.
  const macroImageCache = new Map<string, HTMLImageElement>()
  let hasTexture = 0
  let textureStrength = 0

  const mouse = { x: 0.5, y: 0.5 }
  let intensity = 0
  let targetIntensity = 0
  let mountedAt = 0
  let rafId = 0
  let polySource: PolygonStencilSource | null = null
  let canvasSize = { w: 0, h: 0 }
  // Active material's effect mode. Drives the shader's branch.
  //   0 = off (host fades intensity → render skipped)
  //   1 = holographic opaque
  //   2 = holographic transparent
  //   3 = luminescent
  let modeValue = 0
  // Reusable offscreen canvas for stencil rasterization. Cheaper than
  // newing one per setPolygons call (which can fire on every margin
  // slider drag).
  let stencilOff: OffscreenCanvas | null = null

  function compileShader(glx: WebGLRenderingContext, type: number, src: string) {
    const sh = glx.createShader(type)
    if (!sh) throw new Error('Failed to create shader')
    glx.shaderSource(sh, src)
    glx.compileShader(sh)
    if (!glx.getShaderParameter(sh, glx.COMPILE_STATUS)) {
      const log = glx.getShaderInfoLog(sh)
      glx.deleteShader(sh)
      throw new Error(`Shader compile error: ${log}`)
    }
    return sh
  }

  function initGL(): void {
    if (!canvas.value) return
    const glx = canvas.value.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    })
    if (!glx) {
      console.warn('[holographic-fx] WebGL not available — effect disabled')
      return
    }
    gl.value = glx

    const vs = compileShader(glx, glx.VERTEX_SHADER, VERTEX_SHADER)
    const fs = compileShader(glx, glx.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const prog = glx.createProgram()!
    glx.attachShader(prog, vs)
    glx.attachShader(prog, fs)
    glx.linkProgram(prog)
    if (!glx.getProgramParameter(prog, glx.LINK_STATUS)) {
      const log = glx.getProgramInfoLog(prog)
      throw new Error(`Program link error: ${log}`)
    }
    glx.deleteShader(vs)
    glx.deleteShader(fs)
    program.value = prog

    uniforms.value = {
      u_cut_stencil: glx.getUniformLocation(prog, 'u_cut_stencil'),
      u_artwork_stencil: glx.getUniformLocation(prog, 'u_artwork_stencil'),
      u_material_texture: glx.getUniformLocation(prog, 'u_material_texture'),
      u_has_texture: glx.getUniformLocation(prog, 'u_has_texture'),
      u_texture_strength: glx.getUniformLocation(prog, 'u_texture_strength'),
      u_base_tex: glx.getUniformLocation(prog, 'u_base_tex'),
      u_has_base: glx.getUniformLocation(prog, 'u_has_base'),
      u_time: glx.getUniformLocation(prog, 'u_time'),
      u_mouse: glx.getUniformLocation(prog, 'u_mouse'),
      u_intensity: glx.getUniformLocation(prog, 'u_intensity'),
      u_mode: glx.getUniformLocation(prog, 'u_mode'),
    }

    // Full-screen quad — two triangles covering NDC.
    const quadBuf = glx.createBuffer()!
    glx.bindBuffer(glx.ARRAY_BUFFER, quadBuf)
    glx.bufferData(
      glx.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      glx.STATIC_DRAW,
    )
    const posLoc = glx.getAttribLocation(prog, 'a_position')
    glx.enableVertexAttribArray(posLoc)
    glx.vertexAttribPointer(posLoc, 2, glx.FLOAT, false, 0, 0)

    // Four textures — created once, replaced via setPolygons / setMode /
    // setBaseSnapshot.
    cutTex.value = glx.createTexture()
    artworkTex.value = glx.createTexture()
    macroTex.value = glx.createTexture()
    baseTex.value = glx.createTexture()

    // Pre-multiplied alpha is OFF (we write straight rgba), so the
    // canvas-stack default blend (over-compositing of stacked DOM
    // canvases) just works — the FX canvas is ALPHA over the base.
    glx.enable(glx.BLEND)
    glx.blendFunc(glx.SRC_ALPHA, glx.ONE_MINUS_SRC_ALPHA)

    mountedAt = performance.now()
  }

  /**
   * Build a single-channel ALPHA texture from a polygon. The polygon
   * coords are in image-natural pixels; we rasterize them at the WebGL
   * canvas's drawingBuffer resolution (i.e. CSS-px × DPR) using a 2D
   * OffscreenCanvas, then upload as a texture.
   *
   * Why drawingBuffer resolution (not CSS): the WebGL canvas's
   * gl_FragCoord lives in drawingBuffer pixels. Rasterizing the
   * stencil at CSS resolution and uploading it would force the GPU to
   * upsample with LINEAR filtering, producing a 1-2 px alpha-soft
   * halo at the polygon edge — visible as iridescent fringe leaking
   * past the cut line.
   *
   * We also apply the same `smoothPolygonPerimeter` + Chaikin curve
   * trace the base canvas's `drawBaseLayer` uses, so the stencil
   * boundary matches the clipped artwork edge exactly. Otherwise the
   * artwork's raw pixel-stair edges show through the FX where the
   * smooth FX boundary doesn't cover them.
   */
  function uploadPolygonStencil(
    tex: WebGLTexture,
    points: ImagePoint[],
    src: PolygonStencilSource,
  ) {
    const glx = gl.value
    if (!glx) return
    // Use the actual drawingBuffer resolution — DPR-aware, matches
    // gl_FragCoord and the canvas pixels the shader writes to.
    const w = Math.max(1, glx.drawingBufferWidth)
    const h = Math.max(1, glx.drawingBufferHeight)
    if (!stencilOff || stencilOff.width !== w || stencilOff.height !== h) {
      stencilOff = new OffscreenCanvas(w, h)
    }
    const ctx = stencilOff.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (points.length >= 3) {
      // Apply the SAME smoothing the base canvas uses so the stencil
      // boundary aligns with the clipped artwork edge.
      const smoothed =
        src.smoothingIterations > 0
          ? smoothPolygonPerimeter(points, src.smoothingIterations)
          : points.map((p) => ({ x: p.x, y: p.y }))

      // Polygon coords are in image-natural-px. Convert to drawingBuffer
      // px via fit (CSS-px) × DPR.
      const dprX = w / Math.max(1, canvasSize.w)
      const dprY = h / Math.max(1, canvasSize.h)
      const sx = (src.fit.drawW / src.imageWidth) * dprX
      const sy = (src.fit.drawH / src.imageHeight) * dprY
      const offX = src.fit.offsetX * dprX
      const offY = src.fit.offsetY * dprY

      const cssPath: { x: number; y: number }[] = smoothed.map((p) => ({
        x: offX + p.x * sx,
        y: offY + p.y * sy,
      }))
      ctx.beginPath()
      traceSmoothClosedCurve(ctx, cssPath)
      ctx.closePath()
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }
    glx.bindTexture(glx.TEXTURE_2D, tex)
    glx.texImage2D(
      glx.TEXTURE_2D,
      0,
      glx.LUMINANCE,
      glx.LUMINANCE,
      glx.UNSIGNED_BYTE,
      stencilOff,
    )
    // LINEAR is fine now that the stencil is at drawingBuffer resolution
    // — there's no upsampling, so the boundary stays crisp.
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MIN_FILTER, glx.LINEAR)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MAG_FILTER, glx.LINEAR)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_S, glx.CLAMP_TO_EDGE)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_T, glx.CLAMP_TO_EDGE)
  }

  function rebuildStencils() {
    if (!polySource || !cutTex.value || !artworkTex.value) return
    uploadPolygonStencil(cutTex.value, polySource.cut, polySource)
    // If artwork polygon is null, the cut polygon doubles as the artwork
    // boundary too — the shader's `bleed_mask` evaluates to 0 then, so
    // we just paint everything at "artwork interior" alpha. This is the
    // natural fallback for geometric shapes.
    const artworkPts = polySource.artwork ?? polySource.cut
    uploadPolygonStencil(artworkTex.value, artworkPts, polySource)
  }

  /**
   * Load + upload the macro reference texture for the given mode. Async
   * (image decode happens off the main thread). On success, sets
   * hasTexture=1 + textureStrength to the per-mode preset; on failure
   * (no PNG bundled, or decode error), leaves hasTexture=0 so the
   * shader's apply_macro_texture noops.
   *
   * Cached: same URL won't re-fetch once loaded.
   */
  function loadMacroForMode(
    mode:
      | 'holographic'
      | 'holographic_transparent'
      | 'luminescent'
      | 'eggshell_holographic'
      | null,
  ) {
    if (mode === null) {
      hasTexture = 0
      textureStrength = 0
      return
    }
    const material = MODE_TO_MATERIAL[mode]
    const url = MATERIAL_MACRO_URLS[material]
    if (!url) {
      // No macro PNG bundled for this material → procedural-only.
      // Shader's apply_macro_texture is a no-op when u_has_texture=0,
      // so the visual just falls back to the Track 1 procedural look.
      hasTexture = 0
      textureStrength = 0
      return
    }
    // Cache hit: just flag has_texture and strength; the GL texture
    // already holds the right pixels from the previous load.
    if (macroImageCache.has(url)) {
      hasTexture = 1
      textureStrength = TEXTURE_STRENGTH_BY_MODE[mode] ?? 0.4
      return
    }
    // Miss: fetch + upload async. While loading, the shader keeps
    // running with hasTexture=0 (procedural-only). When the image
    // decodes, we upload to GL and flip the flag — no flash, no jank.
    const img = new Image()
    img.onload = () => {
      const glx = gl.value
      if (!glx || !macroTex.value) return
      glx.bindTexture(glx.TEXTURE_2D, macroTex.value)
      glx.texImage2D(
        glx.TEXTURE_2D,
        0,
        glx.RGB,
        glx.RGB,
        glx.UNSIGNED_BYTE,
        img,
      )
      // REPEAT so the texture tiles across the surface (the apply_macro
      // helper samples at v_uv * 2.0 — i.e. 2 tiles across the canvas).
      // Tileable PNGs are required (the prompt pack documents this).
      glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_S, glx.REPEAT)
      glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_T, glx.REPEAT)
      glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MIN_FILTER, glx.LINEAR)
      glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MAG_FILTER, glx.LINEAR)
      macroImageCache.set(url, img)
      hasTexture = 1
      textureStrength = TEXTURE_STRENGTH_BY_MODE[mode] ?? 0.4
    }
    img.onerror = () => {
      console.warn(`[holographic-fx] macro texture failed: ${url}`)
      hasTexture = 0
      textureStrength = 0
    }
    img.src = url
  }

  function frame() {
    rafId = requestAnimationFrame(frame)
    const glx = gl.value
    const prog = program.value
    const uni = uniforms.value
    if (!glx || !prog || !uni) return

    // Smoothly lerp toward the target intensity. ~150 ms fade.
    intensity += (targetIntensity - intensity) * 0.15
    if (Math.abs(intensity - targetIntensity) < 0.001) intensity = targetIntensity
    if (intensity < 0.001 && targetIntensity === 0) {
      // Clear and skip drawing entirely — saves battery on mobile when
      // the customer's on a non-holographic material.
      glx.clearColor(0, 0, 0, 0)
      glx.clear(glx.COLOR_BUFFER_BIT)
      return
    }

    glx.viewport(0, 0, glx.drawingBufferWidth, glx.drawingBufferHeight)
    glx.clearColor(0, 0, 0, 0)
    glx.clear(glx.COLOR_BUFFER_BIT)

    glx.useProgram(prog)

    glx.activeTexture(glx.TEXTURE0)
    glx.bindTexture(glx.TEXTURE_2D, cutTex.value)
    glx.uniform1i(uni.u_cut_stencil, 0)
    glx.activeTexture(glx.TEXTURE1)
    glx.bindTexture(glx.TEXTURE_2D, artworkTex.value)
    glx.uniform1i(uni.u_artwork_stencil, 1)
    // Macro texture sampler — bound even when hasTexture=0 so the
    // sampler isn't pointing at deleted memory; the shader's
    // apply_macro_texture short-circuits on u_has_texture before any
    // texture2D call, so the bind is just for safety.
    glx.activeTexture(glx.TEXTURE2)
    glx.bindTexture(glx.TEXTURE_2D, macroTex.value)
    glx.uniform1i(uni.u_material_texture, 2)
    glx.uniform1f(uni.u_has_texture, hasTexture)
    glx.uniform1f(uni.u_texture_strength, textureStrength)
    // Base-canvas snapshot — sampled in the shader's bleed branch so the
    // foil tints the underlying base color instead of overwriting it.
    // u_has_base = 0 makes the bleed branch fall back to the legacy
    // gradient (matches pre-fix behavior, no flash before first upload).
    glx.activeTexture(glx.TEXTURE3)
    glx.bindTexture(glx.TEXTURE_2D, baseTex.value)
    glx.uniform1i(uni.u_base_tex, 3)
    glx.uniform1f(uni.u_has_base, hasBase)

    glx.uniform1f(uni.u_time, (performance.now() - mountedAt) / 1000)
    glx.uniform2f(uni.u_mouse, mouse.x, mouse.y)
    glx.uniform1f(uni.u_intensity, intensity)
    glx.uniform1f(uni.u_mode, modeValue)

    glx.drawArrays(glx.TRIANGLES, 0, 6)
  }

  // === Public API ===

  function start() {
    if (!gl.value) initGL()
    if (rafId === 0) frame()
  }

  function setSize(cssW: number, cssH: number) {
    if (!canvas.value) return
    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(cssW * dpr)
    const targetH = Math.round(cssH * dpr)
    if (canvas.value.width !== targetW) canvas.value.width = targetW
    if (canvas.value.height !== targetH) canvas.value.height = targetH
    canvasSize = { w: cssW, h: cssH }
    if (polySource) rebuildStencils()
  }

  /** Material effect mode. Pass `null` or `'off'` to fade out.
   *
   *  All modes use STANDARD alpha blending (no mix-blend-mode tricks).
   *  Previous attempts with `screen` blend universally brightened the
   *  artwork — even deep blacks became pastel-tinted because screen()
   *  mathematically can't preserve a black pixel under any non-black
   *  overlay. The shader now produces sparse, mostly-transparent
   *  output over the artwork (only the specular highlight zones write
   *  visible alpha), so standard alpha blend gives us "shiny laminate
   *  reflections on opaque ink" — which is what real holographic
   *  vinyl does.
   *
   *  Mode value mapping (also referenced in the fragment shader's
   *  main() dispatch):
   *    1 = holografico (cool foil, sharp bands)
   *    2 = holografico_transparente (cool foil, stronger over artwork)
   *    3 = luminescent (greenish-yellow phosphorescent glow)
   *    4 = eggshell_holografico (warm pastel, soft diffuse foil)
   */
  function setMode(
    m:
      | 'holographic'
      | 'holographic_transparent'
      | 'luminescent'
      | 'eggshell_holographic'
      | null,
  ) {
    if (m === 'holographic') modeValue = 1
    else if (m === 'holographic_transparent') modeValue = 2
    else if (m === 'luminescent') modeValue = 3
    else if (m === 'eggshell_holographic') modeValue = 4
    else modeValue = 0
    enabled.value = modeValue > 0
    targetIntensity = modeValue > 0 ? 1 : 0
    // Kick off async load of the per-material macro reference texture.
    // No-op when no PNG is bundled for this material (graceful fallback
    // to procedural shading; ships before Track 2 art assets land).
    loadMacroForMode(m)
    if (canvas.value) {
      // Pointer events off so the FX layer never blocks the UI canvas.
      canvas.value.style.pointerEvents = 'none'
      // No blend mode — standard alpha compositing.
      canvas.value.style.mixBlendMode = ''
    }
  }

  function setPolygons(src: PolygonStencilSource | null) {
    polySource = src
    if (src) rebuildStencils()
  }

  /**
   * Upload the current base 2D canvas pixels as the `u_base_tex` sampler.
   * The shader's bleed branch reads these to TINT (not overlay) the
   * iridescence — preserving the underlying color (e.g. the teal bleed
   * background from smart-cut) instead of replacing it with rainbow.
   *
   * Called by the host (CanvasStage) on the same triggers that already
   * rebuild the polygon stencils (image / fit / mask / artwork /
   * smoothing) — but AFTER the base canvas has finished its own redraw,
   * typically via `nextTick`. Calling before the base draws will upload
   * an empty / stale snapshot and the bleed branch will fall back to the
   * legacy gradient (cheap, no flash).
   *
   * Tolerated cost: ~1 texImage2D per relevant editor event. The base
   * canvas is ~600×600 px in practice; the upload is sub-millisecond on
   * any device that already runs WebGL.
   */
  function setBaseSnapshot(src: HTMLCanvasElement | null) {
    const glx = gl.value
    if (!glx || !baseTex.value) return
    if (!src || src.width === 0 || src.height === 0) {
      hasBase = 0
      return
    }
    glx.bindTexture(glx.TEXTURE_2D, baseTex.value)
    // FLIP_Y false to match the stencil upload + the vertex shader's
    // y-flip in v_uv. Result: v_uv == (0,0) maps to top-left of the base
    // canvas — same coordinate system the stencils use.
    glx.pixelStorei(glx.UNPACK_FLIP_Y_WEBGL, false)
    glx.texImage2D(
      glx.TEXTURE_2D,
      0,
      glx.RGBA,
      glx.RGBA,
      glx.UNSIGNED_BYTE,
      src,
    )
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MIN_FILTER, glx.LINEAR)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_MAG_FILTER, glx.LINEAR)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_S, glx.CLAMP_TO_EDGE)
    glx.texParameteri(glx.TEXTURE_2D, glx.TEXTURE_WRAP_T, glx.CLAMP_TO_EDGE)
    hasBase = 1
  }

  function setMouse(xNorm01: number, yNorm01: number) {
    mouse.x = Math.max(0, Math.min(1, xNorm01))
    mouse.y = Math.max(0, Math.min(1, yNorm01))
  }

  onBeforeUnmount(() => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    const glx = gl.value
    if (glx) {
      if (program.value) glx.deleteProgram(program.value)
      if (cutTex.value) glx.deleteTexture(cutTex.value)
      if (artworkTex.value) glx.deleteTexture(artworkTex.value)
      if (macroTex.value) glx.deleteTexture(macroTex.value)
      if (baseTex.value) glx.deleteTexture(baseTex.value)
      const lose = glx.getExtension('WEBGL_lose_context')
      if (lose) lose.loseContext()
    }
    gl.value = null
    program.value = null
    cutTex.value = null
    artworkTex.value = null
    macroTex.value = null
    baseTex.value = null
    hasBase = 0
    macroImageCache.clear()
  })

  return {
    canvas,
    enabled,
    start,
    setSize,
    setMode,
    setPolygons,
    setBaseSnapshot,
    setMouse,
  }
}
