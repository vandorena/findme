import { Controller } from "@hotwired/stimulus"
import { collectSignals } from "lib/signals"
import { BehaviorTracker } from "lib/behavior"
import { AsciiPortrait, decodeGrid, formatGuesses, csrfToken } from "lib/ascii_portrait"

const WIDTH = 96
const HEIGHT = 48
const REFINE_MS = 4000

// Shows the portrait: collects signals, asks the server who we look like,
// then keeps refining as behaviour accumulates.
export default class extends Controller {
  static targets = ["screen", "status", "guesses", "signals", "bait"]
  static values = { url: String }

  connect() {
    this.current = null
    this.seed = this.sessionSeed()
    this.behavior = new BehaviorTracker(this.hasBaitTarget ? this.baitTarget : null)
    this.behavior.start()
    this.portrait = new AsciiPortrait(this.screenTarget, { width: WIDTH, height: HEIGHT })
    this.portrait.start()
    this.begin()
  }

  disconnect() {
    this.portrait.stop()
    clearInterval(this.refine)
  }

  async begin() {
    this.signals = await collectSignals()
    await this.ask(null)
    this.refine = setInterval(() => {
      if (this.behavior.dirty && !this.pending) this.ask(this.behavior.summary())
    }, REFINE_MS)
  }

  async ask(behavior) {
    this.pending = true
    try {
      const response = await fetch(this.urlValue, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ signals: this.signals, behavior, seed: this.seed, current: this.current })
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      this.show(await response.json())
    } catch {
      this.statusTarget.textContent = "could not reach the mirror, retrying"
      this.behavior.dirty = true
    } finally {
      this.pending = false
    }
  }

  show(result) {
    const grid = result.portrait.id !== this.current ? decodeGrid(result.portrait.grid) : null
    this.current = result.portrait.id
    this.portrait.morphTo(grid, result.confidence)
    const judge = result.source === "jev" ? "judged by Jev" : "rule-of-thumb guess, no model attached"
    this.statusTarget.textContent = `${judge} · confidence ${Math.round(result.confidence * 100)}%`
    this.guessesTarget.textContent = formatGuesses(result.guesses)
    this.signalsTarget.textContent = Object.entries(result.signals)
      .map(([name, value]) => `${name.replaceAll("_", " ").padEnd(24)} ${value}`)
      .join("\n")
  }

  // Stable per tab so a reload shows the same face; never sent anywhere else.
  sessionSeed() {
    try {
      const stored = sessionStorage.getItem("seed")
      if (stored) return Number(stored)
      const seed = Math.floor(Math.random() * 2 ** 31)
      sessionStorage.setItem("seed", String(seed))
      return seed
    } catch {
      return Math.floor(Math.random() * 2 ** 31)
    }
  }
}
