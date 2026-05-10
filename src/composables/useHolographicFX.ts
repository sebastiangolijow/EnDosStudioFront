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
uniform float u_time;        // seconds since mount
uniform vec2  u_mouse;       // 0..1, (0.5,0.5) = center
uniform float u_intensity;   // 0..1, fade in/out
// Mode selector:
//   1.0 = holographic (opaque)
//   2.0 = holographic transparent (drops alpha over artwork interior so
//          the canvas checker reads through, matching vinilo_transparente)
//   3.0 = luminescent (solid greenish-yellow glow, no iridescence)
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

vec3 iridescence(float t) {
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
vec4 mode_holographic(float in_cut, float in_artwork, bool transparent_mode) {
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
  vec3 grad = iridescence(t);

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

  // Hot spot at the mouse position. Falls off quickly so it's a
  // localized "where the light is" indicator, not a general wash.
  vec2 mouse_pos = vec2(u_mouse.x, u_mouse.y);
  float mouse_dist = distance(v_uv, mouse_pos);
  float hotspot = exp(-mouse_dist * mouse_dist * 8.0);

  // Diagonal sweep bands — narrow streaks across the surface.
  // band_axis is positioned along an angle; shifted slightly by the
  // mouse so they "rotate" as the customer tilts. fract() makes them
  // periodic; exp() of a squared distance to the band center makes
  // each band narrow and bright.
  float band_axis = v_uv.x * 1.2 - v_uv.y * 0.6 + (u_mouse.x - 0.5) * 0.3;
  float b1 = exp(-pow(fract(band_axis * 1.4 + 0.10) - 0.5, 2.0) * 80.0);
  float b2 = exp(-pow(fract(band_axis * 2.1 + 0.55) - 0.5, 2.0) * 120.0);
  float b3 = exp(-pow(fract(band_axis * 3.0 + 0.85) - 0.5, 2.0) * 160.0);
  float bands = b1 * 0.65 + b2 * 0.45 + b3 * 0.30;

  // The combined highlight mask. Bands modulated by the hotspot —
  // bands are brightest near the cursor and fade out away from it.
  // This focuses the reflection energy on where the light is hitting,
  // matching real specular behavior.
  float highlight = clamp(bands * (0.4 + hotspot * 0.9), 0.0, 1.0);

  // Soft cut-edge bloom — a thin band of iridescent diffusion JUST
  // INSIDE the polygon boundary. Cheap proxy for the diffused light
  // wrap visible on the reference. Stencil's LINEAR filter gives us a
  // soft 0..1 transition we can grab here.
  float edge_bloom = smoothstep(0.0, 0.45, in_cut)
                   * (1.0 - smoothstep(0.45, 1.0, in_cut));

  // === Composing for the bleed area ===
  //
  // No artwork to preserve here — full holographic surface, vivid
  // colors, bright highlights where they fall.
  vec3 bleed_color = mix(grad, WHITE, clamp(highlight * 0.5, 0.0, 1.0));
  // Multiplicative grain — modulates intensity instead of ADDING
  // brightness. Preserves color.
  float grain_mul = 1.0 + (hash(v_uv * 800.0) - 0.5) * 0.06;
  bleed_color *= grain_mul;
  bleed_color += vec3(edge_bloom) * 0.12;  // subtle inner-edge glow
  float bleed_alpha = 0.95;

  // === Composing for the artwork interior ===
  //
  // Sparse highlights only. Most pixels: alpha = 0 → artwork is
  // fully visible underneath, with all its blacks and saturation
  // intact. Highlight regions: write iridescent color at moderate
  // alpha, simulating a reflection on the laminate surface.
  vec3 artwork_color = grad;
  // Brighten the highlight pattern toward white so it reads as a
  // light reflection. Outside the highlights this is zero, so the
  // artwork color is moot (alpha will be 0 there).
  artwork_color = mix(artwork_color, WHITE, clamp(highlight * 0.7, 0.0, 1.0));
  // Artwork-interior alpha is DRIVEN by the highlight pattern.
  // Maximum alpha 0.55 even at peak highlights so the artwork still
  // reads through clearly. Outside the bands, alpha goes to 0 → the
  // artwork is fully untouched. This is the key change.
  float artwork_alpha = highlight * 0.55;

  // Transparent-mode tweak: under "no white vinyl" the laminate is
  // the only thing on top of the design, so highlights should be a
  // touch stronger over the artwork.
  if (transparent_mode) {
    artwork_alpha = highlight * 0.70;
  }

  // Combine the two regions weighted by stencil. The shader writes
  // either bleed_color@bleed_alpha (where in_artwork ≈ 0) or
  // artwork_color@artwork_alpha (where in_artwork ≈ 1), with smooth
  // interpolation at the artwork edge.
  float bleed_factor = in_cut * (1.0 - in_artwork);
  float artwork_factor = in_cut * in_artwork;
  vec3 rgb = bleed_color * bleed_factor + artwork_color * artwork_factor;
  float alpha = bleed_alpha * bleed_factor + artwork_alpha * artwork_factor;

  return vec4(rgb, alpha);
}

// === Luminescent mode ===
//
// Glow-in-the-dark vinyl. No iridescence — solid greenish-yellow halo
// concentrated in the bleed ring with a gentle pulse that breathes
// over ~3 seconds. Faint over the artwork (so the design still reads
// dominant) but visible enough to communicate "this material glows."
vec4 mode_luminescent(float in_cut, float in_artwork) {
  // Soft pulse — 0.85..1.0 over a ~3s cycle.
  float pulse = 0.92 + 0.08 * sin(u_time * 2.1);

  // Color: vivid yellow-green on the inside, fading to a pale teal at
  // the cut polygon boundary. That's the recognizable "phosphorescent"
  // color of glow vinyl in low light.
  vec3 inner = vec3(0.7, 1.0, 0.4);   // bright yellow-green
  vec3 outer = vec3(0.5, 0.95, 0.85); // pale teal-cyan

  // Distance-from-center within the bleed ring drives the inner→outer
  // mix. Approximate via a quick stencil sample at a slightly larger
  // sample radius — but cheaper just to use the artwork mask as a
  // proxy: closer to artwork = inner, further = outer. Smoothstep for
  // a soft transition.
  float ring_t = smoothstep(0.0, 1.0, in_artwork);
  vec3 glow_color = mix(outer, inner, ring_t) * pulse;

  float bleed_mask = in_cut * (1.0 - in_artwork);
  float artwork_mask = in_cut * in_artwork;

  // Strong in the bleed (the "halo"), faint over the artwork.
  vec3 rgb = glow_color * bleed_mask + glow_color * artwork_mask * 0.4;
  float a  = 0.7 * bleed_mask + 0.18 * artwork_mask;
  return vec4(rgb, a);
}

void main() {
  float in_cut     = texture2D(u_cut_stencil, v_uv).r;
  float in_artwork = texture2D(u_artwork_stencil, v_uv).r;

  if (in_cut < 0.01) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec4 col;
  if (u_mode > 2.5) {
    col = mode_luminescent(in_cut, in_artwork);
  } else if (u_mode > 1.5) {
    col = mode_holographic(in_cut, in_artwork, true);
  } else if (u_mode > 0.5) {
    col = mode_holographic(in_cut, in_artwork, false);
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
    u_time: WebGLUniformLocation | null
    u_mouse: WebGLUniformLocation | null
    u_intensity: WebGLUniformLocation | null
    u_mode: WebGLUniformLocation | null
  } | null>(null)

  const cutTex = shallowRef<WebGLTexture | null>(null)
  const artworkTex = shallowRef<WebGLTexture | null>(null)

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

    // Two textures — created once, replaced via setPolygons.
    cutTex.value = glx.createTexture()
    artworkTex.value = glx.createTexture()

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
   */
  function setMode(
    m: 'holographic' | 'holographic_transparent' | 'luminescent' | null,
  ) {
    if (m === 'holographic') modeValue = 1
    else if (m === 'holographic_transparent') modeValue = 2
    else if (m === 'luminescent') modeValue = 3
    else modeValue = 0
    enabled.value = modeValue > 0
    targetIntensity = modeValue > 0 ? 1 : 0
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
      const lose = glx.getExtension('WEBGL_lose_context')
      if (lose) lose.loseContext()
    }
    gl.value = null
    program.value = null
    cutTex.value = null
    artworkTex.value = null
  })

  return {
    canvas,
    enabled,
    start,
    setSize,
    setMode,
    setPolygons,
    setMouse,
  }
}
