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
const MAX_PITCH = 80 * Math.PI / 180  // how far a drag can tip the poles toward you
const SETTLE_S = 1.2                  // after a fling, how long the globe takes to ease back to its own spin

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
uniform float uPitch;
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
  float sz = sqrt(1.0 - r2);

  // Undo the drag's pitch (about the screen's horizontal axis), then the axial tilt (a roll about the view
  // axis), then read off latitude and longitude.
  float py = p.y * cos(uPitch) + sz * sin(uPitch);
  float z = -p.y * sin(uPitch) + sz * cos(uPitch);
  float gx = p.x * cos(TILT) + py * sin(TILT);
  float gy = -p.x * sin(TILT) + py * cos(TILT);
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
    this.uPitch = gl.getUniformLocation(this.program, "uPitch")
    this.uLod = gl.getUniformLocation(this.program, "uLod")
    this.uGain = gl.getUniformLocation(this.program, "uGain")

    this.planes = new GlobePlanes(this.planesTarget, TILT, landLookup(mask))

    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(canvas)
    this.fit()

    this.still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.auto = this.still ? 0 : DEG_PER_SECOND * Math.PI / 180 // radians per second when nobody is holding it
    this.spin = 0
    this.pitch = 0
    this.spinVel = this.auto
    this.pitchVel = 0
    this.listen()
    if (this.still) return this.draw(0)
    let last = performance.now()
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000) // no lurch after the tab or the globe was hidden
      last = now
      if (canvas.offsetParent === null) return // hidden once the hunt starts
      this.coast(dt)
      this.draw(now)
    }
    this.raf = requestAnimationFrame(loop)
  }

  disconnect() {
    cancelAnimationFrame(this.raf)
    this.resize?.disconnect()
    this.abort?.abort()
  }

  // Grab and spin, like Google Earth without the zoom: the point under the pointer follows it, and a fling
  // keeps turning and then eases back into the globe's own slow spin.
  listen() {
    this.abort = new AbortController()
    const opts = { signal: this.abort.signal }
    const el = this.screenTarget
    el.addEventListener("pointerdown", (e) => {
      const box = el.getBoundingClientRect()
      const x = (e.clientX - box.left) / box.width * 2 - 1
      const y = (e.clientY - box.top) / box.height * 2 - 1
      if (x * x + y * y > 1) return // only the globe itself is grabbable, not the space around it
      el.setPointerCapture(e.pointerId)
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, radius: box.width / 2 }
      this.spinVel = this.pitchVel = 0
      el.classList.add("grabbing")
      e.preventDefault()
    }, opts)
    el.addEventListener("pointermove", (e) => {
      const d = this.drag
      if (!d || e.pointerId !== d.id) return
      const dSpin = (e.clientX - d.x) / d.radius
      const dPitch = (e.clientY - d.y) / d.radius
      const dt = Math.max(1, e.timeStamp - d.t) / 1000
      this.turn(dSpin, dPitch)
      // Smoothed so the last jittery event before letting go doesn't decide the fling.
      this.spinVel = this.spinVel * 0.5 + dSpin / dt * 0.5
      this.pitchVel = this.pitchVel * 0.5 + dPitch / dt * 0.5
      Object.assign(d, { x: e.clientX, y: e.clientY, t: e.timeStamp })
      if (this.still) this.draw(0)
    }, opts)
    const release = (e) => {
      const d = this.drag
      if (!d || e.pointerId !== d.id) return
      // Held still before letting go: it stays put rather than flying off with a stale speed.
      if (e.timeStamp - d.t > 80 || this.still) this.spinVel = this.pitchVel = 0
      this.drag = null
      el.classList.remove("grabbing")
    }
    el.addEventListener("pointerup", release, opts)
    el.addEventListener("pointercancel", release, opts)
  }

  turn(dSpin, dPitch) {
    const full = 2 * Math.PI
    this.spin = ((this.spin + dSpin) % full + full) % full // in [0, 2π), so it can turn forever
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dPitch))
  }

  // Between drags: keep turning at the current speed while it relaxes back to the slow spin.
  coast(dt) {
    if (this.drag) return
    this.turn(this.spinVel * dt, this.pitchVel * dt)
    const ease = Math.exp(-dt / SETTLE_S)
    this.spinVel = this.auto + (this.spinVel - this.auto) * ease
    this.pitchVel *= ease
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
    this.gl.uniform1f(this.uSpin, this.spin ?? 0)
    this.gl.uniform1f(this.uPitch, this.pitch ?? 0)
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
    this.planes.draw(now / 1000, this.spin ?? 0, this.pitch ?? 0)
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
  ctx.fillStyle = "#000"
  for (const ring of WATER) {
    ctx.beginPath()
    ring.forEach(([lon, lat], i) => ctx[i ? "lineTo" : "moveTo"]((lon + 180) * k, (90 - lat) * k))
    ctx.fill()
  }
  return canvas
}

// Rough continent outlines as [lon, lat] rings.
const OUTLINES = [
  // North America, with Hudson Bay, Florida, the Gulf, Baja California and Alaska
  [[-166, 68.5], [-163, 70.5], [-156, 71.3], [-150, 70.4], [-141, 69.7], [-135, 69], [-128, 70], [-117, 68.8],
    [-108, 68], [-98, 67.8], [-94, 69.5], [-89, 68.5], [-82, 69], [-81, 66.5], [-86, 66], [-88, 64], [-93, 61],
    [-94, 58.5], [-92, 57], [-87, 55.5], [-82, 55], [-82, 52], [-79, 51.5], [-78, 55], [-77, 58], [-78, 60.5],
    [-74, 62.3], [-70, 61], [-65, 60], [-64, 57.5], [-61, 55.5], [-57, 53.5], [-56, 51.5], [-60, 50], [-66, 49.5],
    [-65, 48.5], [-60, 47], [-61, 45.5], [-66, 44], [-70, 43.5], [-70, 41.7], [-74, 40.5], [-75.5, 38], [-76, 37],
    [-75.5, 35.3], [-78, 34], [-81, 31.5], [-80.5, 28], [-80, 25.5], [-81, 25.2], [-82.5, 27.5], [-83, 29],
    [-85, 29.8], [-89, 30.3], [-89.5, 29], [-91, 29.3], [-94, 29.7], [-97, 27.8], [-97.5, 25], [-97.8, 22],
    [-96, 19], [-94.5, 18.2], [-91.5, 18.5], [-90.5, 21], [-87, 21.5], [-87.5, 18.5], [-88.5, 16], [-84, 15.8],
    [-83.5, 12], [-83.5, 10.8], [-81.5, 9], [-79, 9.5], [-77.3, 8.3], [-78, 7.5], [-80, 7.5], [-81.5, 8],
    [-84, 9.5], [-85.8, 10.5], [-87.5, 13], [-91.5, 14], [-94, 16], [-96.5, 15.7], [-100, 17], [-105.5, 20],
    [-105.5, 22.5], [-109, 25.5], [-112.5, 29.5], [-114.8, 31.7], [-113, 29], [-112, 27], [-110.5, 24.2],
    [-109.5, 23], [-112, 24.8], [-114, 27.5], [-115.5, 29.8], [-117, 32.5], [-118.5, 34], [-120.6, 34.5],
    [-122.5, 37.5], [-124, 40.4], [-124.5, 43], [-124, 46.5], [-124.7, 48.4], [-123, 49], [-127.5, 51],
    [-130, 54.5], [-133, 57], [-137, 58.5], [-140, 59.8], [-144, 60], [-147.5, 61], [-151, 59.5], [-154, 58],
    [-158, 56.5], [-162, 55], [-158.5, 58], [-161.8, 59], [-164.8, 60.5], [-165.5, 62.3], [-164.5, 63.2],
    [-161, 64.5], [-166, 64.6], [-168, 65.6], [-163, 66.2], [-164.5, 67.3]],
  // Canadian Arctic islands: Baffin, Ellesmere, Victoria, Banks and the smaller ones between
  [[-80, 73.5], [-72, 71], [-66, 68], [-62, 66.5], [-65, 63], [-68, 62.5], [-72, 64.5], [-77, 64.3], [-74, 67.5],
    [-82, 69.8], [-90, 72.5], [-85, 73.5]],
  [[-90, 76.5], [-78, 76], [-75, 79], [-63, 81.5], [-62, 82.5], [-75, 83], [-90, 81.5], [-95, 78.5]],
  [[-118, 70], [-105, 68.5], [-101, 69.5], [-102, 73], [-110, 72.8], [-118, 73]],
  [[-125, 71.5], [-120, 71.3], [-117, 73.5], [-124, 74.3]],
  [[-95, 74.5], [-80, 74.5], [-80, 76.2], [-92, 76.8]],
  [[-101, 72], [-96, 71.5], [-93, 74], [-100, 74]],
  [[-118, 75], [-105, 75.5], [-105, 77.5], [-115, 77]],
  // Newfoundland
  [[-59.3, 47.6], [-56, 49.5], [-55.8, 51.6], [-53.5, 49.3], [-52.7, 47.5], [-53.9, 46.8], [-56, 47.6]],
  // Greenland
  [[-44, 59.8], [-43, 60.5], [-40, 64], [-37, 65.5], [-32, 68.3], [-26, 69.3], [-22, 70.5], [-24, 73], [-20, 75],
    [-18.5, 78], [-19, 80], [-13, 81.5], [-20, 82.2], [-32, 83.6], [-45, 82.7], [-58, 82], [-62, 81.3], [-67, 80],
    [-73, 78.2], [-68, 77], [-60, 76], [-57, 74.5], [-55, 72], [-53, 70.5], [-54, 68], [-52, 65.5], [-50, 63],
    [-48, 61]],
  // Iceland
  [[-22.5, 63.9], [-24, 64.8], [-22, 65.5], [-24, 66], [-22, 66.4], [-18, 66.2], [-14.5, 66.3], [-13.5, 65],
    [-15, 64.3], [-18, 63.4], [-21, 63.8]],
  // Cuba and Hispaniola
  [[-85, 21.9], [-82, 23.2], [-78, 22.6], [-75.5, 21], [-74.2, 20.2], [-77.5, 19.9], [-78, 20.7], [-81.5, 22.2],
    [-84, 21.9]],
  [[-74.5, 18.4], [-72.8, 19.9], [-70, 19.7], [-68.4, 18.6], [-71.5, 17.8], [-74.3, 18.1]],
  // South America
  [[-77, 8.6], [-76, 9.4], [-75.2, 10.8], [-73, 11.3], [-71.5, 12.4], [-71, 11], [-71.8, 10.5], [-71.4, 9.3],
    [-71, 10.8], [-68.5, 10.5], [-64, 10.6], [-61.8, 10.6], [-60, 8.5], [-57.5, 6], [-54, 5.8], [-51.5, 4.2],
    [-50, 1.8], [-50, 0], [-48, -1], [-44.5, -2.5], [-41, -3], [-38.5, -3.8], [-35.2, -5.5], [-35, -8.5],
    [-37, -11], [-39, -14], [-39, -17.8], [-40.5, -21], [-42, -23], [-44.5, -23.3], [-48, -25.5], [-48.6, -28.5],
    [-51, -31], [-53, -33.8], [-55, -35], [-57.2, -35.3], [-56.7, -36.5], [-58, -38.5], [-62, -39], [-62.3, -40.7],
    [-65, -41], [-64.5, -42.5], [-67.5, -46], [-66, -47.5], [-68, -50.5], [-69, -52.3], [-68.5, -54.5], [-67, -55],
    [-71, -55], [-74, -52.5], [-75.5, -48.5], [-74, -44], [-73.5, -41], [-73.5, -37], [-71.5, -33], [-71.5, -28],
    [-70.5, -23], [-70.2, -18.5], [-72, -17], [-76, -14], [-77.2, -12], [-79, -8], [-81.2, -5.5], [-80.3, -3.5],
    [-80, -2], [-80.7, -0.5], [-80, 1], [-78.8, 1.5], [-77.5, 3.7], [-77.3, 6.5], [-78, 7.5]],
  // Eurasia, from Gibraltar up the Atlantic coast, round Scandinavia and Siberia, down the Pacific, round
  // India and Arabia, and back along the Mediterranean. The Baltic, Black and Caspian Seas are cut out below.
  [[-9, 37], [-8.8, 40], [-9.3, 43], [-8, 43.7], [-4, 43.4], [-1.5, 43.4], [-1.2, 46], [-2.5, 47.3], [-4.7, 48],
    [-1.5, 48.7], [0.2, 49.7], [1.6, 50.9], [3.5, 51.4], [4.7, 53], [7, 53.5], [8.7, 54], [8.6, 55.5], [8.1, 56.8],
    [10, 57.6], [10.6, 57.7], [11.5, 58.5], [10.6, 59.3], [8, 58.1], [5.6, 58.5], [5, 60], [5, 61.8], [7, 62.8],
    [10, 64], [13, 66], [15, 68.3], [18, 69.5], [22, 70.3], [26, 71], [30, 70], [33, 69.3], [36, 69], [41, 67],
    [44, 68.5], [53, 68.5], [59, 68.5], [66, 69.5], [69, 72.8], [80, 73], [87, 75], [100, 77.8], [105, 77.5],
    [113, 73.5], [127, 72.5], [131, 71], [140, 72.5], [150, 71.5], [160, 69.8], [170, 70], [180, 69], [180, 65.5],
    [178, 64.6], [177, 62.5], [173, 61.7], [170, 60], [166, 60.2], [163, 59.8], [163.5, 56], [162, 55], [160, 53],
    [156.7, 51], [156, 52.5], [156, 57.5], [160, 61], [155, 59.5], [150, 59.5], [143, 59.3], [138, 56.5], [137, 54],
    [141, 53.3], [140.5, 48.5], [138, 46], [135, 43.5], [132, 43], [130, 42.3], [129.5, 40], [128.5, 38.5],
    [129.4, 36], [129, 35], [126.5, 34.5], [126.5, 37], [125, 37.8], [125, 39.5], [121.5, 40], [122, 40.8],
    [121, 41], [118, 39], [118, 38], [119, 37.2], [122.5, 37], [120.5, 36], [119.5, 35], [121, 32], [122, 30],
    [121.5, 28], [119.5, 25.5], [117, 23.5], [113.5, 22.2], [110.5, 21], [109.8, 21.5], [108, 21.5], [106.5, 20],
    [105.7, 19], [108.5, 15.5], [109.2, 12], [107, 10.5], [105, 8.6], [104.8, 10.3], [103, 11], [100.8, 12.8],
    [100, 13.4], [99.2, 10], [100.3, 8], [102.2, 6.2], [103.3, 4], [104.2, 1.4], [103.5, 1.3], [101.3, 3],
    [100.3, 5.5], [98.3, 8], [98.5, 10], [98.7, 12.5], [97.6, 16.5], [94.3, 16], [94.2, 18.8], [92.3, 20.7],
    [91.8, 22.5], [90.5, 22.2], [88.5, 21.7], [87, 21.5], [86.5, 20], [84.5, 19], [82, 16.5], [80.3, 15.5],
    [80, 13], [79.8, 10.3], [78, 8.5], [77.5, 8], [76.5, 9], [75.5, 11.5], [74.5, 14], [73, 17.5], [72.8, 21],
    [70, 20.8], [69, 22.5], [68.5, 23.6], [66.6, 25.4], [64, 25.3], [61.6, 25.2], [57.3, 25.8], [56.6, 27],
    [54.5, 26.6], [51.5, 27.9], [50, 30], [48, 29.8], [48.5, 28.3], [50, 26.5], [51.5, 25.3], [51.6, 24.2],
    [54, 24.2], [56, 26], [56.4, 24.8], [58.5, 23.6], [59.8, 22.4], [58.5, 20.5], [57.7, 19], [55, 17.3],
    [52.2, 16], [48.5, 14], [45, 13], [43.5, 12.7], [42.7, 16], [41.5, 18.5], [39.2, 21.5], [38.5, 23.8],
    [37, 25.8], [35.2, 28.1], [34.6, 28], [34.9, 29.5], [34.3, 31.3], [35, 32.8], [35.9, 35.5], [36.2, 36.6],
    [34.6, 36.8], [32.5, 36.1], [30.5, 36.3], [28.3, 36.8], [27.3, 37.4], [26.4, 38.5], [26.2, 39.5], [26.6, 40.3],
    [26, 40.8], [24, 40.8], [23, 40.3], [22.6, 40.5], [22.8, 39.3], [24, 38.2], [23, 37.5], [22.6, 36.5],
    [21.7, 36.8], [21.1, 38.3], [20.2, 39.5], [19.4, 40.4], [19.5, 41.8], [18.5, 42.4], [16, 43.5], [15, 44.5],
    [13.6, 45.6], [12.3, 45.3], [12.5, 44], [13.7, 43.5], [16, 41.5], [18.5, 40.1], [17, 39], [16.6, 38.4],
    [15.7, 38], [16.2, 39], [15.6, 40], [14.3, 40.6], [12.5, 41.7], [11, 42.5], [10.2, 43.9], [8.8, 44.4],
    [7.5, 43.8], [6, 43.1], [4.5, 43.4], [3, 43], [3.2, 42], [0.8, 41], [0, 39.8], [-0.3, 38.5], [-0.7, 37.6],
    [-2.1, 36.7], [-4.4, 36.7], [-5.6, 36]],
  // Chukotka, east of the antimeridian
  [[-180, 69], [-175, 67.8], [-170, 66.2], [-172.5, 64.4], [-177, 65], [-180, 65.5]],
  // Arctic islands: Svalbard and Novaya Zemlya
  [[11, 78.5], [16, 76.5], [22, 77.5], [27, 80], [18, 80.5], [11, 79.7]],
  [[52, 71.5], [56, 70.6], [57.5, 71.2], [55.5, 73.5], [60, 75.5], [68.5, 76.8], [64, 77], [57, 75.3], [54, 73.5]],
  // Great Britain and Ireland
  [[-5.7, 50.1], [-3, 50.6], [1.4, 51.2], [1.7, 52.7], [0.3, 53.4], [-0.5, 54.5], [-1.6, 55.6], [-2.2, 57],
    [-1.8, 57.6], [-4, 57.6], [-3, 58.6], [-5, 58.6], [-6, 57.5], [-5.6, 56.3], [-5.1, 55.2], [-3.5, 54.9],
    [-3.2, 54.1], [-3, 53.4], [-4.6, 53.3], [-4.2, 52.3], [-5.2, 51.8], [-3.4, 51.4], [-5.5, 50.5]],
  [[-6, 52], [-6, 53.9], [-5.5, 54.5], [-6.4, 55.3], [-8.5, 55], [-10, 54], [-9.8, 53], [-10.3, 51.8], [-8, 51.6]],
  // Sicily, Sardinia and Corsica
  [[12.4, 38], [15.6, 38.3], [15.1, 36.7]],
  [[8.4, 39], [9.6, 39.1], [9.8, 41], [8.6, 41], [8.1, 40]],
  [[8.6, 41.4], [9.4, 41.4], [9.5, 43], [8.6, 42.3]],
  // Africa
  [[-5.9, 35.8], [-9.6, 30.4], [-9.8, 29.5], [-13, 27.6], [-14.5, 26], [-16, 23.8], [-17, 21], [-16.5, 19.3],
    [-16.8, 15], [-17.5, 14.7], [-16.7, 12.5], [-15, 11], [-13.3, 9], [-11.5, 6.9], [-9, 5], [-7.5, 4.4], [-4, 5.2],
    [-1, 5], [1.5, 6.2], [4.5, 6.3], [6, 4.3], [8.5, 4.5], [9.7, 3.5], [9.8, 1], [9, -1], [11.8, -3.8], [12.2, -6],
    [13.3, -8.8], [13.6, -12], [11.8, -16.5], [12.5, -18.8], [14.5, -22.8], [15.2, -27], [16.5, -28.6], [18.3, -32],
    [18.4, -34.2], [20, -34.8], [22.5, -34], [25.6, -34], [27.5, -33.2], [30, -31.2], [31.3, -29.4], [32.6, -26],
    [32.9, -25.5], [35.5, -24], [35.4, -21], [34.7, -19.7], [36.5, -18.5], [39.5, -16.5], [40.6, -14.5],
    [40.5, -10.5], [39.3, -7.7], [39.2, -4.7], [40.2, -2.8], [41.6, -1.6], [43.5, 0.5], [46, 2.4], [48.7, 5.4],
    [50.8, 10.5], [51.3, 11.8], [49, 11.2], [45, 10.5], [43.3, 11.5], [42.5, 13.2], [41, 15], [39.2, 16.3],
    [38.5, 18.2], [37.3, 21], [36.9, 22.2], [35.6, 23.9], [34.4, 26], [32.6, 29.9], [32.3, 31.2], [29.9, 31.2],
    [25.2, 31.6], [22, 33], [20, 30.9], [19, 30.3], [15.8, 31.5], [15, 32.7], [11.5, 33.1], [10.2, 34.3],
    [11.1, 35.2], [10.4, 36.6], [9.8, 37.3], [8.6, 36.9], [5, 36.8], [1.5, 36.6], [-1.5, 35.2], [-2.9, 35.3],
    [-5.3, 35.9]],
  // Madagascar
  [[44.1, -25], [45.2, -25.6], [47.2, -24.9], [48.7, -20], [50, -15.8], [50.4, -15.2], [49.3, -12], [48.6, -13.5],
    [47.2, -15], [45.6, -15.8], [44.4, -16.5], [44, -18.5], [44.4, -20.5], [43.6, -22], [43.7, -24]],
  // Sri Lanka and Hainan
  [[79.8, 6.5], [80, 9.8], [81.3, 8.5], [81.8, 7], [80.6, 5.9]],
  [[108.6, 19], [110.5, 20.1], [111, 19.6], [109.6, 18.2]],
  // Japan (Honshu with Kyushu and Shikoku, then Hokkaido), Sakhalin and Taiwan
  [[130.2, 31.3], [131.5, 31.4], [132, 33.5], [133.8, 33.5], [135.2, 33.7], [135.8, 33.5], [136.8, 34.3],
    [138.8, 34.7], [140, 35], [140.9, 36.8], [141, 38.3], [142, 39.5], [141.5, 41.3], [140, 40.7], [140, 39.5],
    [139.5, 38], [137.5, 37], [136.7, 37.3], [136, 36], [133, 35.5], [131, 34.5], [130.3, 33.6], [129.7, 33]],
  [[140, 41.5], [141.2, 41.8], [143.3, 42], [145.6, 43.3], [144.3, 44.1], [142, 45.4], [141.5, 43.4], [140.4, 43.2]],
  [[142, 46], [143.5, 46.5], [143, 49.5], [144.5, 49], [143, 54.3], [142.3, 54.2], [142, 51], [141.8, 48.7]],
  [[120.1, 23], [121, 25.2], [122, 25], [121, 22], [120.7, 22]],
  // The Philippines: Luzon and Mindanao
  [[120, 16.3], [120.6, 18.5], [122.2, 18.5], [122.3, 16.5], [121.6, 15], [124, 13.5], [123.5, 12.7], [120.6, 13.8],
    [120.5, 15]],
  [[122, 7], [123.5, 8], [125.4, 9.7], [126.5, 7.5], [125.5, 5.6], [124, 6.4]],
  // Sumatra, Java, Borneo, Sulawesi and New Guinea
  [[95.3, 5.6], [97.5, 5.2], [100.4, 2.2], [103.8, -1], [106, -3.1], [105.8, -5.8], [104.5, -5.9], [102.3, -4],
    [100.4, -0.8], [98.7, 1.7], [96, 3.8]],
  [[105.2, -6.8], [106.5, -6], [108.3, -6.3], [110.4, -6.9], [112.6, -6.9], [114.5, -7.8], [114.4, -8.7],
    [111, -8.2], [108, -7.8], [106, -7.4]],
  [[109, 1.5], [109.6, 2], [111, 1.7], [113, 3.2], [115.5, 5.3], [116.8, 7], [117.7, 6], [119, 5], [117.8, 4.1],
    [117.5, 1.5], [119, 0.9], [118.2, -0.5], [116.5, -2.5], [116, -3.9], [114.5, -4], [111.8, -3.4], [110.2, -2.9],
    [109, -1.2]],
  [[119.5, -5.5], [120.4, -5.5], [120.6, -3], [122, -4.8], [123.2, -4.7], [121.5, -1.5], [123, -0.9], [120.5, -0.8],
    [121, 0.4], [124.9, 1.6], [120.2, 1.2], [119.7, 0], [119.3, -1.5], [119.5, -3.5]],
  [[131, -1.2], [132.5, -0.4], [134.1, -0.9], [135, -3.3], [137.8, -1.5], [141, -2.6], [145.8, -4.9], [147.5, -6.2],
    [147.8, -8], [150.2, -10.3], [148, -10.1], [146.1, -8.1], [143.5, -9.1], [142.6, -9.3], [141, -9.1],
    [139, -8.1], [138.8, -7], [137.8, -5.3], [135.2, -4.4], [133.3, -4], [132, -2.8], [133.5, -2.2], [132, -2]],
  // Australia and Tasmania
  [[113.5, -22], [114.2, -21.8], [116.7, -20.6], [121, -19.5], [122.2, -17.2], [125.5, -14.5], [127.5, -14],
    [129.6, -14.9], [130.3, -12.4], [132.5, -11.4], [136, -12], [136.8, -12.3], [135.9, -13.3], [135.5, -15],
    [140.5, -17.6], [141.6, -15], [141.6, -12.6], [142.5, -10.7], [143.5, -13.9], [145.3, -15], [146.3, -19],
    [148.8, -20.5], [150.8, -22.7], [153.2, -25.8], [153.6, -28.6], [152.5, -32.4], [151, -34.3], [150, -37.5],
    [147.5, -38], [144.5, -38.2], [141, -38.1], [139.7, -37.2], [138.5, -35], [137.8, -34.9], [137.5, -33.4],
    [135.8, -34.8], [135.2, -34.5], [134, -32.8], [131.2, -31.5], [126, -32.3], [123.5, -33.9], [120, -34],
    [117.8, -35], [115, -34.3], [115.7, -32], [115, -29.5], [113.4, -26.2], [113.9, -24.5]],
  [[144.7, -40.7], [148.3, -40.9], [148, -42.9], [146.8, -43.6], [145.3, -42.2]],
  // New Zealand
  [[172.7, -34.4], [174.5, -36], [175.8, -37], [178.5, -37.7], [177.9, -39.1], [176.9, -39.6], [175.3, -41.6],
    [174.6, -41.3], [175, -39.9], [173.8, -39.2], [174.6, -38], [173.1, -35.2]],
  [[172.6, -40.5], [174.3, -41.3], [173.4, -43], [171.2, -44.5], [169.3, -46.6], [166.5, -46], [167, -45],
    [168.3, -44], [170.8, -42.7], [172.1, -41]],
  // Antarctica: the coast west to east, out along the Peninsula and back, then closed along the bottom edge of
  // the map, which is the South Pole stretched across the whole width.
  [[-180, -78], [-170, -78], [-160, -79], [-150, -77], [-140, -75], [-130, -74], [-120, -73.5], [-110, -74],
    [-100, -72.5], [-90, -73], [-80, -73], [-75, -71.5], [-70, -69], [-68, -67], [-65, -65], [-62, -64],
    [-58, -63.3], [-57, -64], [-60, -66], [-62, -68], [-63, -70], [-61, -72], [-60, -75], [-50, -77.5],
    [-40, -78], [-35, -77], [-30, -76], [-20, -74], [-15, -72], [-10, -71], [0, -70], [10, -70], [20, -70],
    [30, -69.5], [40, -69], [50, -67], [60, -67], [70, -68], [72, -70], [75, -69], [80, -67], [90, -66.5],
    [100, -66], [110, -66], [120, -66.5], [130, -66], [140, -66.5], [150, -68.5], [160, -70], [165, -71],
    [170, -72], [166, -74], [164, -76], [166, -77.5], [170, -78], [180, -78], [180, -90], [-180, -90]]
]

// Inland seas, cut back out of the land after it is drawn.
const WATER = [
  // The Baltic, with the Gulfs of Bothnia and Finland
  [[10.6, 57.7], [12.5, 56.3], [12.6, 55.6], [14.3, 55.5], [16, 56.2], [16.5, 57.5], [18.5, 59.3], [17.5, 60.5],
    [17.3, 62.3], [19, 63.5], [21, 64.6], [22, 65.7], [25.3, 65], [24.5, 64.7], [21.5, 63], [21.5, 61], [23, 60],
    [28, 60.5], [30, 59.9], [28, 59.5], [23.5, 59.2], [24.3, 57.8], [23.5, 57], [21, 57], [21, 55.2], [18.5, 54.8],
    [14.2, 53.9], [12, 54.2], [10.8, 54.5], [10.6, 56.2]],
  // The Black Sea and the Sea of Azov
  [[28, 41.5], [28.6, 43.5], [30.5, 46.5], [33, 46], [32.5, 45.3], [33.5, 44.5], [35, 45], [36.5, 45.3], [38.5, 47],
    [39.5, 46.8], [38, 45], [41.6, 41.6], [38.3, 40.9], [35, 42], [31.2, 41.1], [29, 41.2]],
  // The Caspian Sea
  [[47, 44.5], [49, 46.5], [51, 47], [53, 46.5], [53, 45], [51, 44.3], [52.8, 41.5], [54, 40], [53.9, 37.3],
    [51, 36.7], [49, 37.6], [49.5, 40.3], [48.5, 41.8], [47.5, 43]]
]
