// Draws a brightness grid into a <pre> as ASCII and morphs between grids.
// Before the first grid arrives the screen is pure static; afterwards the
// static fades in proportion to how sure we are of the face.
const RAMP = " .`:-~=+*cox#%8@"
const MORPH_MS = 700
const FRAME_MS = 90

export class AsciiPortrait {
  constructor(screen, { width, height }) {
    this.screen = screen
    this.width = width
    this.height = height
    this.cells = width * height
    this.from = new Float32Array(this.cells)
    this.to = null
    this.confidence = 0
    this.morphStart = 0
  }

  start() {
    this.frame = setInterval(() => this.draw(), FRAME_MS)
    this.draw()
  }

  stop() {
    clearInterval(this.frame)
  }

  // grid is a Uint8Array of length cells, or null to keep the current face.
  morphTo(grid, confidence) {
    this.confidence = confidence
    if (!grid) return
    this.from = this.snapshot()
    this.to = grid
    this.morphStart = performance.now()
  }

  snapshot() {
    if (!this.to) return this.from
    const t = this.progress()
    return this.from.map((value, i) => value + (this.to[i] - value) * t)
  }

  progress() {
    const t = Math.min(1, (performance.now() - this.morphStart) / MORPH_MS)
    return t * t * (3 - 2 * t)
  }

  draw() {
    const t = this.to ? this.progress() : 0
    const noise = this.to ? 8 + (1 - this.confidence) * 24 : 255
    const top = RAMP.length - 1
    let text = ""
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const i = row * this.width + col
        const base = this.to ? this.from[i] + (this.to[i] - this.from[i]) * t : 0
        const value = base + (Math.random() - 0.5) * noise
        text += RAMP[Math.max(0, Math.min(top, Math.round((value / 255) * top)))]
      }
      text += "\n"
    }
    this.screen.textContent = text
  }
}

export function decodeGrid(base64) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

// trait rows -> aligned bars for a <pre>.
export function formatGuesses(guesses) {
  return guesses
    .map((guess) => {
      const filled = Math.round(guess.p * 10)
      const bar = "#".repeat(filled) + ".".repeat(10 - filled)
      const percent = `${Math.round(guess.p * 100)}%`.padStart(4)
      return `${guess.trait.padEnd(14)} ${bar} ${percent}  ${guess.label}${guess.unsure ? "  (unsure)" : ""}`
    })
    .join("\n")
}

export function csrfToken() {
  return document.querySelector("meta[name=csrf-token]")?.content ?? ""
}
