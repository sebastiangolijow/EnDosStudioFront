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
  // Max alpha contribution over the artwork interior at peak highlight.
  // 0.55 = standard foil. Higher for "transparent" SKUs (more visible
  // through). Lower for "eggshell" (subtler).
  float artwork_alpha_peak;
  // Highlight color blend toward white. Foil = vivid (low blend, ~0.5);
  // eggshell = soft (more white, ~0.8); makes the bands read like soft
  // diffused sheen instead of crisp specular.
  float highlight_white_mix;
  // Bleed alpha — full holographic in the bleed ring.
  float bleed_alpha;
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
  // sticker, simulating "tilting the foil to catch light at a
  // different angle". Two-octave noise warp gives organic color
  // boundaries instead of straight diagonal stripes.
  float n1 = noise(v_uv * 3.0) * 0.18;
  float n2 = noise(v_uv * 9.0) * 0.06;
  float warp = n1 + n2;
  float diag = (v_uv.x + v_uv.y) * 0.5;
  float phase = (u_mouse.x - 0.5) * 1.5 + (u_mouse.y - 0.5) * 0.8;
  float t = diag + warp + phase;
  vec3 grad = sample_iridescence(p.palette_id, t);
  // Modulate by the macro texture (foil dot / paper fiber grain) at
  // u_texture_strength. No-op when no macro PNG is bundled.
  grad = apply_macro_texture(grad, u_texture_strength);

  // === Specular highlight pattern ===
  //
  // This is the heart of the new approach. We compute a 0..1 mask that
  // says "where would light reflections actually appear on this
  // sticker if it were tilted toward the cursor?" Then we use that
  // mask to drive the artwork-interior alpha — most pixels get 0,
  // only the simulated specular zones get visible iridescence.
  //
  // The pattern combines:
  //   1. A broad mouse-anchored hot spot (where the "light" hits
  //      hardest)
  //   2. Three thin diagonal bands at offsets, like the streaks of
  //      reflection you see on real holographic foil
  //
  // Both are squared/exp'd so they're MOSTLY zero — the bands are
  // narrow streaks, not broad swaths. That's the "sparse highlight"
  // architecture.

  // Hot spot at the mouse position. p.hotspot_focus controls the
  // tightness — foil = sharp small spot, eggshell = broader softer spot.
  vec2 mouse_pos = vec2(u_mouse.x, u_mouse.y);
  float mouse_dist = distance(v_uv, mouse_pos);
  float hotspot = exp(-mouse_dist * mouse_dist * p.hotspot_focus);

  // Diagonal sweep bands — narrow streaks across the surface. Sharpness
  // per material via p.band_sharpness_*: foil bands are tight + crisp;
  // eggshell bands are wide + soft so the iridescence reads diffuse.
  float band_axis = v_uv.x * 1.2 - v_uv.y * 0.6 + (u_mouse.x - 0.5) * 0.3;
  float b1 = exp(-pow(fract(band_axis * 1.4 + 0.10) - 0.5, 2.0) * p.band_sharpness_1);
  float b2 = exp(-pow(fract(band_axis * 2.1 + 0.55) - 0.5, 2.0) * p.band_sharpness_2);
  float b3 = exp(-pow(fract(band_axis * 3.0 + 0.85) - 0.5, 2.0) * p.band_sharpness_3);
  float bands = b1 * 0.65 + b2 * 0.45 + b3 * 0.30;

  // Combined highlight mask. Bands × hotspot focuses reflection energy
  // near the cursor — matches real specular behavior.
  float highlight = clamp(bands * (0.4 + hotspot * 0.9), 0.0, 1.0);

  // Soft cut-edge bloom — thin diffused-light band just inside the
  // polygon boundary. Same in all modes.
  float edge_bloom = smoothstep(0.0, 0.45, in_cut)
                   * (1.0 - smoothstep(0.45, 1.0, in_cut));

  // === Bleed area — TINT the underlying base, don't overlay ===
  //
  // Mental model: holographic foil is a transparent iridescent laminate.
  // Real foil over a teal substrate still reads as teal — the laminate
  // adds a tilt-dependent hue shift, never replaces the base color.
  //
  // Smart-cut now preserves the customer's source RGB in the bleed ring
  // (the "background extends outward" feel). Reading those pixels back
  // here and tinting them — instead of painting iridescence on top —
  // gives us the target look: teal bleed stays teal, just with rainbow
  // shimmer modulating its hue.
  //
  // Composition:
  //   1. base_rgb       — the underlying canvas color (teal in the gorilla case)
  //   2. tinted         — base × gradient × gain — multiply blend preserves
  //                       base hue, gradient adds chromatic modulation
  //   3. + highlights   — brighten only at sparse specular zones (the "shimmer")
  //   4. mix(base, …)   — final has at most 70% tint contribution, so base
  //                       color is always recognizable
  //   5. has_base gate  — when no snapshot is uploaded (e.g. before first
  //                       render) OR the base canvas is transparent here
  //                       (geometric shapes with no source pixels in the
  //                       bleed ring), fall back to the legacy paint-on-top
  //                       gradient so the customer still sees the foil
  //                       effect — the no-op visual matches the previous
  //                       FX layer behavior.
  vec4 base_sample = texture2D(u_base_tex, v_uv);
  vec3 base_rgb = base_sample.rgb;
  float base_avail = u_has_base * base_sample.a;
  // Multiply tint with gain. ×1.6 compensates so mid-bright base ×
  // mid-bright grad doesn't dim the overall result — keeps brightness
  // similar to the source.
  vec3 tinted = base_rgb * grad * 1.6;
  // Sparse highlight brightening — same highlight mask the artwork
  // branch uses, so the shimmer streaks sweep across base and artwork
  // in concert (sells the "single laminate over the whole sticker" feel).
  tinted = mix(tinted, WHITE, clamp(highlight * 0.35, 0.0, 1.0));
  // Final tinted bleed — at most 70% of the way from base to tint, so
  // the underlying hue (teal) is never lost.
  vec3 tinted_bleed = mix(base_rgb, tinted, 0.7);
  // Legacy gradient overlay — fallback when base snapshot unavailable.
  // Kept verbatim from the previous version of this branch.
  vec3 legacy_bleed = mix(grad, WHITE, clamp(highlight * 0.5, 0.0, 1.0));
  // Smooth choice between the two — clamped multiply so the fallback
  // doesn't suddenly snap in when the base canvas's alpha edge falls
  // here (the smart-cut RGBA has a thin alpha-soft boundary).
  vec3 bleed_color = mix(legacy_bleed, tinted_bleed, clamp(base_avail, 0.0, 1.0));
  float grain_mul = 1.0 + (hash(v_uv * 800.0) - 0.5) * 0.06;
  bleed_color *= grain_mul;
  bleed_color += vec3(edge_bloom) * 0.12;

  // === Artwork interior — sparse highlights, artwork preserved ===
  vec3 artwork_color = mix(
    grad, WHITE,
    clamp(highlight * p.highlight_white_mix, 0.0, 1.0)
  );
  float artwork_alpha = highlight * p.artwork_alpha_peak;

  // Compose by stencil weighting.
  float bleed_factor = in_cut * (1.0 - in_artwork);
  float artwork_factor = in_cut * in_artwork;
  vec3 rgb = bleed_color * bleed_factor + artwork_color * artwork_factor;
  float alpha = p.bleed_alpha * bleed_factor + artwork_alpha * artwork_factor;

  return vec4(rgb, alpha);
}

// === Per-material parameter presets ===
//
// Each material gets distinct shader behavior so the customer sees a
// real difference picking holografico vs holografico_transparente vs
// eggshell_holografico. The parameter ranges were tuned by reading
// what the previous unified shader did and adjusting in directions
// that match each material's physical character.

MaterialParams params_holografico() {
  // Cool foil — vivid neon palette, sharp tight bands, focused hot
  // spot, moderate highlight whiteness. The "default" holographic.
  return MaterialParams(
    0,        // palette_id: cool
    80.0,     // band_sharpness_1
    120.0,    // band_sharpness_2
    160.0,    // band_sharpness_3
    8.0,      // hotspot_focus (tight)
    0.55,     // artwork_alpha_peak
    0.7,      // highlight_white_mix
    0.95      // bleed_alpha
  );
}

MaterialParams params_holografico_transparente() {
  // Same cool palette + sharp bands as holografico, but stronger
  // visibility of iridescence over the artwork because there's no
  // opaque white vinyl backing. Higher artwork_alpha_peak. Slightly
  // brighter highlight (more white-mix) for the "translucent foil
  // catching light from both sides" feel.
  return MaterialParams(
    0,        // palette_id: cool
    100.0,    // band_sharpness_1 (slightly tighter for "thin clear film" feel)
    140.0,    // band_sharpness_2
    180.0,    // band_sharpness_3
    6.0,      // hotspot_focus (slightly broader — more spread)
    0.78,     // artwork_alpha_peak (much higher than opaque)
    0.85,     // highlight_white_mix (more bright peaks)
    0.85      // bleed_alpha (slightly less than opaque — more transparent)
  );
}

MaterialParams params_eggshell_holografico() {
  // Warm pastel palette, broad SOFT bands, broad hotspot, low alpha
  // peak. Reads as a paper-printed foil with diffuse iridescence —
  // the eggshell substrate is the dominant character; the foil only
  // adds a subtle warm sheen. The eggshell PNG halo in the bleed
  // (drawn by the mask layer) carries the cream-paper texture.
  return MaterialParams(
    1,        // palette_id: warm
    25.0,     // band_sharpness_1 (much softer/broader — diffuse)
    35.0,     // band_sharpness_2
    50.0,     // band_sharpness_3
    4.0,      // hotspot_focus (broad)
    0.38,     // artwork_alpha_peak (subtler — paper foil isn't as bright)
    0.5,      // highlight_white_mix (less bright — soft pastel sheen)
    0.55      // bleed_alpha (lower so the eggshell texture halo dominates)
  );
}

// === Luminescent mode ===
//
// Glow-in-the-dark vinyl. Now follows the same "laminate over opaque
// ink" architecture as holographic — artwork preserved, glow only at
// edges + mouse hotspot. The previous version had a uniform alpha
// overlay over the whole artwork which washed out the design (the same
// bug we just fixed for holographic; this is the matching fix here).
//
// Visual signal:
//   - Edge bloom — strong greenish-yellow halo where the cut polygon
//     boundary diffuses inward (the "phosphorescent rim" of glow
//     vinyl seen in low light)
//   - Mouse-anchored brightening — a subtle pulse follows the cursor
//     so the customer sees the glow react like a real material
//   - Bleed ring — solid greenish-yellow at high alpha, gentle pulse
//   - Artwork interior — alpha 0 except at the immediate cut-edge
//     band, so the gorilla's blacks/colors stay intact
vec4 mode_luminescent(float in_cut, float in_artwork) {
  // Slow autonomous pulse — 0.92..1.00 over a ~3s cycle. The only
  // mode where time-driven animation is appropriate (it's literally
  // a phosphorescent material with reactive luminance).
  float pulse = 0.92 + 0.08 * sin(u_time * 2.1);

  // Phosphorescent palette — bright yellow-green with a teal cool
  // tone. Same as before; this part was correct.
  vec3 inner = vec3(0.70, 1.00, 0.40);
  vec3 outer = vec3(0.50, 0.95, 0.85);

  // Mouse-anchored hot spot — broad, soft. Concentrates the "fresh
  // energy" near the cursor.
  vec2 mouse_pos = vec2(u_mouse.x, u_mouse.y);
  float hotspot = exp(-distance(v_uv, mouse_pos) * distance(v_uv, mouse_pos) * 5.0);

  // Edge band — wider than the holographic edge_bloom because the
  // glow visibly diffuses inward on real glow vinyl. This is what
  // sells the "this material glows" signal — the gorilla appears to
  // be CARVED OUT of the glow, with luminance leaking around its edge.
  float edge_band = smoothstep(0.0, 0.6, in_cut)
                  * (1.0 - smoothstep(0.6, 1.0, in_cut));

  // Color mix — inner toward the artwork, outer toward the bleed
  // boundary. Adds gentle pulse modulation.
  float ring_t = smoothstep(0.0, 1.0, in_artwork);
  vec3 glow_color = mix(outer, inner, ring_t) * pulse;
  // Macro texture modulation (glow particle grain). No-op when the
  // luminiscente_macro.png isn't bundled.
  glow_color = apply_macro_texture(glow_color, u_texture_strength);

  // === Bleed area — solid glow halo, full alpha ===
  vec3 bleed_color = glow_color;
  float bleed_alpha = 0.85 * (0.85 + hotspot * 0.15);

  // === Artwork interior — alpha mostly zero, visible only at edge ===
  // The phosphorescent leak at the artwork's cut-line boundary is what
  // sells "glow material". Outside that thin band, the artwork shows
  // through 100% intact.
  float artwork_glow_alpha = edge_band * 0.55 + hotspot * 0.10;
  vec3 artwork_color = glow_color * 1.05;

  float bleed_factor = in_cut * (1.0 - in_artwork);
  float artwork_factor = in_cut * in_artwork;
  vec3 rgb = bleed_color * bleed_factor + artwork_color * artwork_factor;
  float alpha = bleed_alpha * bleed_factor + artwork_glow_alpha * artwork_factor;

  return vec4(rgb, alpha);
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
