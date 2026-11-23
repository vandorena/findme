import { Controller } from "@hotwired/stimulus"

// An LED dot-matrix sign in the globe's colours: the letters are lit amber dots on a panel of dim
// sea-blue ones. On load the dots switch on in a random order, like a sign powering up, and (if planes
// are on) every few seconds a small plane made of white dots flies across the panel, leaving a fading trail.
//
// The findme title uses the big 5x7 font with planes; the subtitle under it uses the small font without.
// If a line of text would make the dots smaller than minPitch, the sign wraps onto more lines at spaces.
const FONTS = {
  big: {
    rows: 7,
    glyphs: {
      f: ["..##.", ".#..#", ".#...", "###..", ".#...", ".#...", ".#..."],
      i: ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
      n: [".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
      d: ["....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####"],
      m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
      e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."]
    }
  },
  // Lowercase in a 6-row cell: row 0 for ascenders, rows 1-4 the body, row 5 for descenders.
  small: {
    rows: 6,
    glyphs: {
      a: ["...", ".##", "#.#", "#.#", ".##", "..."],
      b: ["#..", "##.", "#.#", "#.#", "##.", "..."],
      c: ["...", ".##", "#..", "#..", ".##", "..."],
      d: ["..#", ".##", "#.#", "#.#", ".##", "..."],
      e: ["...", ".#.", "###", "#..", ".##", "..."],
      f: [".##", ".#.", "###", ".#.", ".#.", "..."],
      g: ["...", ".##", "#.#", ".##", "..#", "##."],
      h: ["#..", "##.", "#.#", "#.#", "#.#", "..."],
      i: [".#.", "...", ".#.", ".#.", ".#.", "..."],
      l: ["#.", "#.", "#.", "#.", ".#", ".."],
      m: [".....", "####.", "#.#.#", "#.#.#", "#.#.#", "....."],
      n: ["...", "##.", "#.#", "#.#", "#.#", "..."],
      o: ["...", ".#.", "#.#", "#.#", ".#.", "..."],
      p: ["...", "##.", "#.#", "##.", "#..", "#.."],
      r: ["...", "#.#", "##.", "#..", "#..", "..."],
      s: ["...", ".##", ".#.", "..#", "##.", "..."],
      t: [".#.", "###", ".#.", ".#.", ".##", "..."],
      u: ["...", "#.#", "#.#", "#.#", ".##", "..."],
      y: ["...", "#.#", "#.#", ".##", "..#", "##."]
    }
  }
}
const SPACE = 2                     // columns for a space, on top of the gap either side
const PAD = 1                       // unlit dots either side of the lettering; none above or below, to keep it slim
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
  static values = {
    text: String,
    font: { type: String, default: "big" },
    pitch: { type: Number, default: 6.5 },   // dot spacing in CSS px when there is room
    minPitch: { type: Number, default: 0 },  // below this, wrap onto another line
    planes: { type: Boolean, default: true }
  }

  connect() {
    this.ctx = this.element.getContext("2d")
    this.font = FONTS[this.fontValue]
    this.trail = new Map() // fuselage cell -> when the plane's tail left it
    this.plane = new Set() // cells under the plane this frame
    this.still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.onResize = () => this.fit()
    window.addEventListener("resize", this.onResize)
    this.fit()
    if (this.still) return

    const loop = (now) => {
      this.raf = requestAnimationFrame(loop)
      if (this.element.offsetParent === null) return // hidden once the hunt starts
      this.draw(now / 1000)
    }
    this.raf = requestAnimationFrame(loop)
  }

  disconnect() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener("resize", this.onResize)
  }

  // How many columns a run of text takes, gaps between letters included.
  width(text) {
    return [...text].reduce((w, ch) => w + (ch === " " ? SPACE : this.font.glyphs[ch][0].length) + 1, -1)
  }

  // Splits the text into as few lines as keep the dots at least minPitch apart in the space available.
  layout(room) {
    const words = this.textValue.split(" ")
    for (let n = 1; n <= words.length; n++) {
      const lines = []
      const per = Math.ceil(this.width(this.textValue) / n)
      let line = ""
      for (const word of words) {
        const next = line ? `${line} ${word}` : word
        if (line && this.width(next) > per) { lines.push(line); line = word } else line = next
      }
      lines.push(line)
      const cols = PAD * 2 + Math.max(...lines.map((l) => this.width(l)))
      if (room / cols >= this.minPitchValue || n === words.length) return lines
    }
  }

  fit() {
    const room = Math.min(document.documentElement.clientWidth - 32, 900)
    const lines = this.layout(room)
    const { rows, glyphs } = this.font
    if (lines.join("\n") !== this.lines?.join("\n")) {
      this.lines = lines
      this.cols = PAD * 2 + Math.max(...lines.map((l) => this.width(l)))
      this.rows = lines.length * rows + (lines.length - 1) // one unlit row between lines
      this.bootAt = new Float32Array(this.cols * this.rows).fill(-1) // when each letter dot switches on; -1 = never
      lines.forEach((line, n) => {
        let x = PAD + Math.floor((this.cols - PAD * 2 - this.width(line)) / 2)
        for (const ch of line) {
          if (ch === " ") { x += SPACE + 1; continue }
          glyphs[ch].forEach((row, r) => [...row].forEach((c, k) => {
            if (c === "#") this.bootAt[(n * (rows + 1) + r) * this.cols + x + k] = Math.random() * BOOT_S
          }))
          x += glyphs[ch][0].length + 1
        }
      })
      this.trail.clear()
      this.flight = null
    }

    const dpr = window.devicePixelRatio || 1
    this.pitch = Math.min(this.pitchValue, room / this.cols)
    this.w = this.cols * this.pitch
    this.h = this.rows * this.pitch
    this.element.style.width = `${this.w}px`
    this.element.style.height = `${this.h}px`
    this.element.width = Math.round(this.w * dpr)
    this.element.height = Math.round(this.h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (this.still) this.draw(Infinity)
  }

  draw(t) {
    this.started ??= t
    const age = t - this.started
    this.fly(t)

    const { ctx, pitch, cols, rows } = this
    ctx.clearRect(0, 0, this.w, this.h)
    const r = pitch * 0.36
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col
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
    if (this.still || !this.planesValue) return
    const { cols, rows } = this
    this.nextFlight ??= t + BOOT_S + 1.5
    if (!this.flight && t >= this.nextFlight) {
      const row = 2 + Math.floor(Math.random() * (rows - 4)) // wingtips stay on the panel
      this.flight = { start: t, row: this.flown ? row : row + 1 } // the first flight comes in a dot lower
      this.flown = true
    }
    this.plane.clear()
    if (!this.flight) return
    const nose = Math.floor((t - this.flight.start) * FLIGHT_SPEED) - 1
    if (nose - 7 > cols) {
      this.flight = null
      this.nextFlight = t + FLIGHT_GAP_S[0] + Math.random() * (FLIGHT_GAP_S[1] - FLIGHT_GAP_S[0])
      return
    }
    for (const [dx, dy] of PLANE) {
      const col = nose + dx, row = this.flight.row + dy
      if (col >= 0 && col < cols && row >= 0 && row < rows) this.plane.add(row * cols + col)
    }
    for (let col = Math.max(0, nose - 6); col <= Math.min(cols - 1, nose); col++) {
      this.trail.set(this.flight.row * cols + col, t)
    }
    for (const [i, seen] of this.trail) if (t - seen > TRAIL_S) this.trail.delete(i)
  }
}
