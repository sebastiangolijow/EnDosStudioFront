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

// 5-stop iridescent palette — same hex stops the existing 2D overlay
// uses, so the WebGL shimmer reads as the same material as the bleed
// halo's bundled holographic.png texture.
const vec3 C_CYAN   = vec3(0.133, 0.827, 0.933);   // #22D3EE
const vec3 C_VIOLET = vec3(0.659, 0.333, 0.969);   // #A855F7
const vec3 C_PINK   = vec3(0.957, 0.447, 0.714);   // #F472B6
const vec3 C_GOLD   = vec3(0.980, 0.800, 0.082);   // #FACC15
const vec3 C_LIME   = vec3(0.639, 0.902, 0.208);   // #A3E635

// Cheap value-noise. Hash → smoothstep blend of 4 corners. Good enough
// for the warp; we don't need perceptual quality, just non-uniformity.
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

// Sample the iridescent palette at parameter t in 0..1, with smooth
// transitions between the 5 stops.
vec3 iridescence(float t) {
  t = fract(t);  // wrap for the animated phase shift
  if (t < 0.25)      return mix(C_CYAN,   C_VIOLET, t * 4.0);
  else if (t < 0.5)  return mix(C_VIOLET, C_PINK,   (t - 0.25) * 4.0);
  else if (t < 0.75) return mix(C_PINK,   C_GOLD,   (t - 0.5) * 4.0);
  else               return mix(C_GOLD,   C_LIME,   (t - 0.75) * 4.0);
}

void main() {
  // Single-channel stencil textures encode "is this UV inside the
  // polygon?" 1.0 = inside, 0.0 = outside. The artwork stencil is the
  // tight silhouette; the cut stencil includes the bleed margin. So:
  //   inside_artwork  = inside the artwork itself
  //   inside_bleed    = inside cut polygon but outside artwork
  //   outside         = outside cut polygon (don't render anything)
  float in_cut     = texture2D(u_cut_stencil, v_uv).r;
  float in_artwork = texture2D(u_artwork_stencil, v_uv).r;

  if (in_cut < 0.01) {
    // Outside the cut polygon → fully transparent.
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // Iridescent gradient parameter — diagonal across the canvas, with a
  // mouse-driven phase shift so the colors slide as the customer moves
  // their cursor. Animated drift via u_time gives a slow autonomous
  // shimmer even when the cursor is still.
  float diag = (v_uv.x + v_uv.y) * 0.5;
  float warp = noise(v_uv * 6.0 + u_time * 0.05) * 0.15;
  float phase = u_time * 0.04 + (u_mouse.x - 0.5) * 0.6;
  float t = diag + warp + phase;
  vec3 grad = iridescence(t);

  // Highlight bands — periodic Gaussian-ish stripes at a different angle
  // that "sweep" across the surface over time. This is what gives a
  // physical-feeling reflection like the gorilla example image #9.
  float band_axis = v_uv.x * 1.3 - v_uv.y * 0.7 + u_time * 0.15;
  float band = exp(-pow(fract(band_axis * 1.7) - 0.5, 2.0) * 30.0);
  // Second band at a slightly different frequency for richness.
  float band2 = exp(-pow(fract(band_axis * 2.3 + 0.4) - 0.5, 2.0) * 60.0);
  float highlight = (band * 0.5 + band2 * 0.3);

  // Bleed area: full-strength holographic with a hint of base brightness.
  // Artwork interior: subtler — the artwork colors should still read
  // dominant, the iridescence only kisses them.
  float bleed_mask = in_cut * (1.0 - in_artwork);
  float artwork_mask = in_cut * in_artwork;

  // Outside-the-artwork (bleed ring): rich color + bright highlights.
  vec3 bleed_color = grad + vec3(highlight) * 0.8;
  float bleed_alpha = 0.95;

  // Inside-the-artwork: low-alpha tint + soft highlights. Screen-style
  // blend will be done by GL_BLEND_SRC_ALPHA on the host side.
  vec3 artwork_color = grad + vec3(highlight) * 0.6;
  float artwork_alpha = 0.32 * (0.5 + highlight);

  vec3 final_rgb = bleed_color * bleed_mask + artwork_color * artwork_mask;
  float final_a  = bleed_alpha * bleed_mask + artwork_alpha * artwork_mask;

  gl_FragColor = vec4(final_rgb * u_intensity, final_a * u_intensity);
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

  function setEnabled(v: boolean) {
    enabled.value = v
    targetIntensity = v ? 1 : 0
    if (canvas.value) {
      // Toggle pointer-events off so the FX layer never blocks the UI
      // canvas from receiving cursor events. Display stays so the rAF
      // can fade out smoothly; only flips to none after intensity hits 0.
      canvas.value.style.pointerEvents = 'none'
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
    setEnabled,
    setPolygons,
    setMouse,
  }
}
