import { Controller } from "@hotwired/stimulus"

// The findme title as an LED dot-matrix sign in the globe's colours: the letters are lit amber dots on
// a panel of dim sea-blue ones. On load the dots switch on in a random order, like a sign powering up,
// and every few seconds a small plane made of white dots flies across the panel, leaving a fading trail.
const GLYPHS = {
  f: ["..##.", ".#..#", ".#...", "###..", ".#...", ".#...", ".#..."],
  i: ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
  n: [".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  d: ["....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####"],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."]
}
const WORD = "findme"
const PAD = 1                       // unlit dots around the lettering
const COLS = PAD * 2 + WORD.length * 6 - 1
const ROWS = PAD * 2 + 7
// The plane seen from above, nose at [0, 0] and flying right: fuselage, swept-back wings, tailplane.
//   ..#....
//   #..#...
//   #######
//   #..#...
//   ..#....
const PLANE = [[0, 0], [-1, 0], [-2, 0], [-3, 0], [-4, 0], [-5, 0], [-6, 0],
  [-3, -1], [-3, 1], [-4, -2], [-4, 2], [-6, -1], [-6, 1]]
const BOOT_S = 1.1                  // how long powering up takes
const FLIGHT_GAP_S = [5, 10]
const FLIGHT_SPEED = 16             // dots per second
const TRAIL_S = 1.2               // the contrail behind the fuselage

const AMBER = [255, 176, 0]
const OFF = [16, 28, 92]            // the sea's dark blue, for unlit dots
const WHITE = [255, 255, 255]

export default class extends Controller {
  connect() {
    this.ctx = this.element.getContext("2d")
    this.lit = new Float32Array(COLS * ROWS)
    this.bootAt = new Float32Array(COLS * ROWS).fill(-1) // when each letter dot switches on; -1 = never
    let x = PAD
    for (const ch of WORD) {
      GLYPHS[ch].forEach((row, r) => [...row].forEach((c, k) => {
        if (c === "#") this.bootAt[(PAD + r) * COLS + x + k] = Math.random() * BOOT_S
      }))
      x += 6
    }
    this.trail = new Map() // fuselage cell -> when the plane's tail left it
    this.plane = new Set() // cells under the plane this frame
    this.still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(this.element)
    this.fit()
    if (this.still) return this.draw(Infinity)

    const loop = (now) => {
      this.raf = requestAnimationFrame(loop)
      if (this.element.offsetParent === null) return // hidden once the hunt starts
      this.draw(now / 1000)
    }
    this.raf = requestAnimationFrame(loop)
  }

  disconnect() {
    cancelAnimationFrame(this.raf)
    this.resize?.disconnect()
  }

  fit() {
    const dpr = window.devicePixelRatio || 1
    this.w = this.element.clientWidth
    this.h = this.w * ROWS / COLS
    this.element.width = Math.round(this.w * dpr)
    this.element.height = Math.round(this.h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.pitch = this.w / COLS
    if (this.still) this.draw(Infinity)
  }

  draw(t) {
    this.started ??= t
    const age = t - this.started
    this.fly(t)

    const { ctx, pitch } = this
    ctx.clearRect(0, 0, this.w, this.h)
    const r = pitch * 0.36
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = row * COLS + col
        // Letter dots flash bright as they switch on, then settle.
        const on = this.bootAt[i] >= 0 && age >= this.bootAt[i]
        const flash = on ? Math.max(0, 1 - (age - this.bootAt[i]) / 0.25) : 0
        let color = on ? AMBER : OFF
        let alpha = on ? 1 : 0.55
        // The plane and its trail whiten whatever they pass over.
        const seen = this.trail.get(i)
        const white = this.plane.has(i) ? 1 : seen === undefined ? 0 : Math.max(0, 1 - (t - seen) / TRAIL_S) * 0.5
        if (white > 0 || flash > 0) {
          const k = Math.max(white, flash * 0.6)
          color = color.map((c, n) => c + (WHITE[n] - c) * k)
          alpha = Math.max(alpha, k)
        }
        ctx.globalAlpha = alpha
        ctx.fillStyle = `rgb(${color.map(Math.round).join(",")})`
        ctx.shadowColor = on || white > 0.3 ? ctx.fillStyle : "transparent"
        ctx.shadowBlur = on || white > 0.3 ? pitch * 0.9 : 0
        ctx.beginPath()
        ctx.arc((col + 0.5) * pitch, (row + 0.5) * pitch, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
  }

  // Launches a plane now and then, and marks the dots it covers this frame.
  fly(t) {
    if (this.still) return
    this.nextFlight ??= t + BOOT_S + 1.5
    if (!this.flight && t >= this.nextFlight) {
      this.flight = { start: t, row: 2 + Math.floor(Math.random() * (ROWS - 4)) } // wingtips stay on the panel
    }
    this.plane.clear()
    if (!this.flight) return
    const nose = Math.floor((t - this.flight.start) * FLIGHT_SPEED) - 1
    if (nose - 7 > COLS) {
      this.flight = null
      this.nextFlight = t + FLIGHT_GAP_S[0] + Math.random() * (FLIGHT_GAP_S[1] - FLIGHT_GAP_S[0])
      return
    }
    for (const [dx, dy] of PLANE) {
      const col = nose + dx, row = this.flight.row + dy
      if (col >= 0 && col < COLS && row >= 0 && row < ROWS) this.plane.add(row * COLS + col)
    }
    for (let col = Math.max(0, nose - 6); col <= Math.min(COLS - 1, nose); col++) {
      this.trail.set(this.flight.row * COLS + col, t)
    }
    for (const [i, seen] of this.trail) if (t - seen > TRAIL_S) this.trail.delete(i)
  }
}
