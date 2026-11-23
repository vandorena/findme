import { Controller } from "@hotwired/stimulus"

// A spinning ASCII Earth. Each character cell is a ray onto a unit sphere; we turn the hit point into
// latitude and longitude, look it up in a coarse land mask, and pick a character by how lit it is.
const COLS = 80
const ROWS = 48          // cells are ~0.6em wide and 1em tall at line-height 1, so 80 x 48 draws a circle
const TILT = 23.4 * Math.PI / 180
const DEG_PER_SECOND = 12
const FRAME_MS = 50
const LAND = ".:-=+*#%@"
const SEA = " .,:"
const LIGHT = normalize([-0.5, 0.45, 0.75])

export default class extends Controller {
  static targets = ["screen"]

  connect() {
    this.started = performance.now()
    this.lastFrame = 0
    this.draw(0)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop)
      // Skip frames while the globe is hidden (the hunt has started) or between ticks.
      if (now - this.lastFrame < FRAME_MS || this.screenTarget.offsetParent === null) return
      this.lastFrame = now
      this.draw((now - this.started) / 1000 * DEG_PER_SECOND)
    }
    this.raf = requestAnimationFrame(loop)
  }

  disconnect() {
    cancelAnimationFrame(this.raf)
  }

  draw(spinDeg) {
    const spin = spinDeg * Math.PI / 180
    const cosT = Math.cos(TILT), sinT = Math.sin(TILT)
    let html = ""
    for (let row = 0; row < ROWS; row++) {
      let run = "", runLand = null
      const flush = () => {
        if (run) html += runLand ? `<span class="land">${run}</span>` : run
        run = ""
      }
      for (let col = 0; col < COLS; col++) {
        const x = (col + 0.5 - COLS / 2) / (COLS / 2)
        const y = -(row + 0.5 - ROWS / 2) / (ROWS / 2)
        const r2 = x * x + y * y
        if (r2 > 1) {
          if (runLand) flush()
          runLand = false
          run += " "
          continue
        }
        const z = Math.sqrt(1 - r2)
        // Undo the axial tilt (a roll about the view axis), then read off latitude and longitude.
        const gx = x * cosT + y * sinT
        const gy = -x * sinT + y * cosT
        const lat = Math.asin(gy) * 180 / Math.PI
        const lon = wrap((Math.atan2(gx, z) - spin) * 180 / Math.PI)
        const land = isLand(lat, lon)
        const light = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2])
        const ramp = land ? LAND : SEA
        const ch = ramp[Math.min(ramp.length - 1, Math.floor((0.25 + 0.75 * light) * ramp.length))]
        if (runLand !== land) flush()
        runLand = land
        run += ch
      }
      flush()
      html += "\n"
    }
    this.screenTarget.innerHTML = html
  }
}

function normalize([x, y, z]) {
  const n = Math.hypot(x, y, z)
  return [x / n, y / n, z / n]
}

function wrap(lon) {
  return ((lon + 540) % 360) - 180
}

// Rough continent outlines as [lon, lat] rings: good enough to recognise at 80 characters across.
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

// One cell per degree, rasterised once.
const MASK = (() => {
  const mask = new Uint8Array(360 * 180)
  for (let lat = -90; lat < 90; lat++) {
    for (let lon = -180; lon < 180; lon++) {
      const px = lon + 0.5, py = lat + 0.5
      const land = py < -68 || OUTLINES.some((ring) => inside(ring, px, py))
      mask[(lat + 90) * 360 + (lon + 180)] = land ? 1 : 0
    }
  }
  return mask
})()

function isLand(lat, lon) {
  const row = Math.min(179, Math.max(0, Math.floor(lat + 90)))
  const col = Math.min(359, Math.max(0, Math.floor(lon + 180)))
  return MASK[row * 360 + col] === 1
}

function inside(ring, x, y) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
