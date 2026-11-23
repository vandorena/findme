import { Controller } from "@hotwired/stimulus"
import { GlobePlanes } from "lib/globe_planes"

// A spinning ASCII Earth, 280 x 168 characters. That is far too many glyphs to lay out as text every frame,
// so a WebGL2 fragment shader does it: for every character cell it casts a ray onto a unit sphere, turns the
// hit point into latitude and longitude, looks that up in a land mask, picks the land or sea character,
// and stamps that character from a glyph atlas.
const COLS = 280
const TILT = 23.4 * Math.PI / 180
const ROWS = 168         // cells are 0.6 wide by 1 tall, so 280 x 168 cells make a square canvas
// Flat: one character for sea, one for land, no shading.
const SEA = ":"
const LAND = "@"
const GLYPHS = SEA + LAND
const GLYPH_W = 24
const GLYPH_H = 40
const DEG_PER_SECOND = 12
const MASK_PX_PER_DEG = 4

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uMask;
uniform sampler2D uAtlas;
uniform float uSpin;
uniform float uLod;
uniform float uGain;
const vec2 GRID = vec2(${COLS}.0, ${ROWS}.0);
const float GLYPH_N = ${GLYPHS.length}.0;
const float TILT = ${TILT.toFixed(6)};
const float PI = 3.14159265;

void main() {
  vec2 c = vUv * GRID;
  vec2 cell = floor(c);
  vec2 local = fract(c);
  vec2 p = (cell + 0.5) / GRID * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) { outColor = vec4(0.0); return; } // transparent, so the stars show around the globe
  float z = sqrt(1.0 - r2);

  // Undo the axial tilt (a roll about the view axis), then read off latitude and longitude.
  float gx = p.x * cos(TILT) + p.y * sin(TILT);
  float gy = -p.x * sin(TILT) + p.y * cos(TILT);
  float lat = asin(clamp(gy, -1.0, 1.0));
  float lon = atan(gx, z) - uSpin;
  vec2 maskUv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
  bool land = texture(uMask, maskUv).r > 0.5;

  float glyph = land ? 1.0 : 0.0;
  float ink = textureLod(uAtlas, vec2((glyph + local.x) / GLYPH_N, 1.0 - local.y), uLod).a;
  vec3 color = land ? vec3(1.0, 0.69, 0.0) : vec3(0.06, 0.12, 0.5); // amber land, very dark blue sea
  outColor = vec4(color * min(1.0, ink * uGain), 1.0);
}`

export default class extends Controller {
  static targets = ["screen", "planes"]

  connect() {
    const canvas = this.screenTarget
    const gl = canvas.getContext("webgl2", { antialias: false })
    if (!gl) return // purely decorative: without WebGL2 the globe just isn't there
    this.gl = gl
    this.program = link(gl, VERTEX, FRAGMENT)
    gl.useProgram(this.program)

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(this.program, "aPos")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const mask = landMask()
    texture(gl, 0, mask, false)
    const atlas = glyphAtlas()
    this.maxInk = atlas.maxInk
    texture(gl, 1, atlas.canvas, true)
    gl.uniform1i(gl.getUniformLocation(this.program, "uMask"), 0)
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 1)
    this.uSpin = gl.getUniformLocation(this.program, "uSpin")
    this.uLod = gl.getUniformLocation(this.program, "uLod")
    this.uGain = gl.getUniformLocation(this.program, "uGain")

    this.planes = new GlobePlanes(this.planesTarget, TILT, landLookup(mask))

    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(canvas)
    this.fit()

    this.started = performance.now()
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return this.draw(0)
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop)
      if (canvas.offsetParent === null) return // hidden once the hunt starts
      this.draw(now)
    }
    this.raf = requestAnimationFrame(loop)
  }

  disconnect() {
    cancelAnimationFrame(this.raf)
    this.resize?.disconnect()
  }

  fit() {
    const canvas = this.screenTarget
    const dpr = window.devicePixelRatio || 1
    const size = Math.max(1, Math.round(canvas.clientWidth * dpr))
    this.planes.fit(canvas.clientWidth, dpr)
    canvas.width = canvas.height = size
    this.gl.viewport(0, 0, size, size)
    // Pick the atlas mip level whose glyphs are about one screen cell tall, so tiny glyphs average to
    // their ink density instead of shimmering.
    const lod = Math.max(0, Math.log2(GLYPH_H / (size / ROWS)))
    this.gl.uniform1f(this.uLod, lod)
    // Shrunk that far, a glyph is just its ink coverage (a third of the cell at most), so brighten until the
    // densest glyph reaches full colour. Big, legible glyphs need no gain.
    this.gl.uniform1f(this.uGain, 1 + (1 / this.maxInk - 1) * Math.min(1, lod / 3))
    this.draw(performance.now())
  }

  draw(now) {
    // Keep the angle in [0, 2π) so it can spin forever without losing float precision.
    const spin = ((now - (this.started ?? now)) / 1000 * DEG_PER_SECOND * Math.PI / 180) % (2 * Math.PI)
    this.gl.uniform1f(this.uSpin, spin)
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
    this.planes.draw(now / 1000, spin)
  }
}

function link(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
  return program
}

function texture(gl, unit, source, mipmapped) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  if (mipmapped) gl.generateMipmap(gl.TEXTURE_2D)
}

// One strip of white glyphs on transparent, in GLYPHS order.
function glyphAtlas() {
  const canvas = document.createElement("canvas")
  canvas.width = GLYPHS.length * GLYPH_W
  canvas.height = GLYPH_H
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  ctx.font = `${GLYPH_H * 0.9}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "#fff"
  ;[...GLYPHS].forEach((ch, i) => ctx.fillText(ch, i * GLYPH_W + GLYPH_W / 2, GLYPH_H / 2))
  // How much of its cell the densest glyph inks, so the shader can brighten shrunken glyphs to full colour.
  const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const ink = [...GLYPHS].map((_, g) => {
    let sum = 0
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = g * GLYPH_W; x < (g + 1) * GLYPH_W; x++) sum += alpha[(y * canvas.width + x) * 4 + 3]
    }
    return sum / 255 / (GLYPH_W * GLYPH_H)
  })
  return { canvas, maxInk: Math.max(...ink) }
}

// The same mask, read back on the CPU so planes can pick airports on land.
function landLookup(mask) {
  const k = MASK_PX_PER_DEG
  const pixels = mask.getContext("2d").getImageData(0, 0, mask.width, mask.height).data
  return (lat, lon) => {
    const x = Math.min(mask.width - 1, Math.floor((lon + 180) * k))
    const y = Math.min(mask.height - 1, Math.floor((90 - lat) * k))
    return pixels[(y * mask.width + x) * 4] > 127
  }
}

// Equirectangular land mask, white on black, row 0 at 90°N.
function landMask() {
  const k = MASK_PX_PER_DEG
  const canvas = document.createElement("canvas")
  canvas.width = 360 * k
  canvas.height = 180 * k
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = "#fff"
  for (const ring of OUTLINES) {
    ctx.beginPath()
    ring.forEach(([lon, lat], i) => ctx[i ? "lineTo" : "moveTo"]((lon + 180) * k, (90 - lat) * k))
    ctx.fill()
  }
  ctx.fillRect(0, (90 + 68) * k, canvas.width, canvas.height) // Antarctica
  return canvas
}

// Rough continent outlines as [lon, lat] rings.
const OUTLINES = [
  // North America
  [[-168, 66], [-162, 70], [-140, 70], [-125, 70], [-95, 72], [-80, 73], [-62, 60], [-55, 52], [-66, 45], [-70, 42],
    [-76, 35], [-81, 31], [-80, 25], [-82, 27], [-84, 30], [-90, 29], [-97, 27], [-97, 22], [-92, 18], [-87, 21],
    [-88, 16], [-83, 10], [-78, 8], [-80, 8], [-86, 12], [-92, 15], [-105, 20], [-110, 24], [-115, 30], [-118, 34],
    [-124, 40], [-124, 48], [-130, 55], [-140, 60], [-152, 59], [-158, 56], [-165, 60]],
  // Canadian Arctic islands
  [[-120, 72], [-80, 74], [-65, 82], [-90, 82], [-120, 77]],
  // Greenland
  [[-55, 60], [-45, 60], [-20, 70], [-18, 80], [-35, 83], [-60, 82], [-70, 77], [-55, 70]],
  // Iceland
  [[-24, 65], [-14, 66], [-14, 64], [-22, 63]],
  // South America
  [[-78, 8], [-72, 12], [-62, 10], [-50, 0], [-35, -5], [-38, -13], [-40, -22], [-48, -26], [-53, -33], [-58, -38],
    [-65, -41], [-66, -48], [-69, -52], [-72, -54], [-75, -48], [-73, -38], [-71, -30], [-70, -18], [-76, -14],
    [-81, -5], [-80, 0], [-77, 4]],
  // Eurasia
  [[-10, 36], [-9, 43], [-2, 44], [-4, 48], [2, 51], [8, 54], [10, 57], [5, 58], [5, 62], [15, 69], [25, 71], [40, 68],
    [60, 70], [70, 73], [80, 73], [100, 77], [115, 74], [140, 72], [160, 70], [180, 68], [180, 65], [170, 60], [160, 55],
    [156, 51], [163, 59], [142, 59], [135, 54], [140, 47], [132, 43], [129, 35], [126, 38], [121, 40], [122, 31],
    [120, 25], [110, 20], [106, 10], [100, 13], [103, 1], [98, 8], [98, 16], [92, 22], [88, 22], [80, 15], [77, 8],
    [73, 20], [66, 25], [57, 25], [56, 27], [50, 30], [48, 29], [52, 24], [56, 26], [59, 22], [52, 16], [43, 13],
    [35, 28], [34, 31], [36, 36], [28, 36], [26, 40], [23, 37], [20, 40], [19, 42], [13, 45], [18, 40], [16, 38],
    [12, 44], [8, 44], [3, 43], [-1, 37], [-6, 36]],
  // Chukotka, east of the antimeridian
  [[-180, 65], [-180, 68], [-172, 66], [-170, 65]],
  // Great Britain
  [[-5, 50], [1, 51], [-2, 56], [-3, 58.5], [-6, 58], [-5, 55]],
  // Africa
  [[-17, 21], [-17, 15], [-15, 10], [-8, 4], [5, 5], [9, 4], [10, -2], [13, -10], [12, -17], [15, -27], [18, -34],
    [26, -34], [33, -28], [35, -22], [40, -15], [40, -8], [39, -4], [42, 2], [51, 12], [43, 12], [37, 19], [32, 30],
    [20, 32], [10, 34], [10, 37], [-2, 35], [-6, 36], [-10, 30]],
  // Madagascar
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -17]],
  // Japan
  [[130, 31], [135, 34], [140, 35], [142, 40], [141, 45], [145, 44], [140, 41], [136, 37], [131, 34]],
  // Borneo, Sumatra, New Guinea
  [[109, 2], [117, 7], [119, 1], [116, -4], [110, -3]],
  [[95, 5], [98, 4], [106, -6], [103, -5]],
  [[131, -1], [141, -3], [150, -10], [141, -9], [138, -8]],
  // Australia
  [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -26], [150, -37], [141, -38],
    [135, -35], [130, -31], [115, -34]],
  // New Zealand
  [[172, -34], [178, -38], [174, -41], [167, -46], [171, -44]]
]
