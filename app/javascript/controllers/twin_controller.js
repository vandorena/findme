import { Controller } from "@hotwired/stimulus"
import { AsciiPortrait, decodeGrid, formatGuesses, csrfToken } from "lib/ascii_portrait"

const WIDTH = 96
const HEIGHT = 48

// Builds a synthetic twin from a photo the signed-in visitor uploads. The file
// is sent once to the server, which reads its features and returns the nearest
// bank portrait; the file never leaves this form otherwise.
export default class extends Controller {
  static targets = ["screen", "status", "guesses", "file"]
  static values = { url: String }

  connect() {
    this.current = null
    this.portrait = new AsciiPortrait(this.screenTarget, { width: WIDTH, height: HEIGHT })
    this.portrait.start()
  }

  disconnect() {
    this.portrait.stop()
  }

  async submit() {
    const file = this.fileTarget.files[0]
    if (!file) return
    this.statusTarget.textContent = "reading your face"

    const body = new FormData()
    body.append("photo", file)
    body.append("current", this.current ?? "")

    try {
      const response = await fetch(this.urlValue, {
        method: "POST",
        headers: { "Accept": "application/json", "X-CSRF-Token": csrfToken() },
        body
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
      this.show(result)
    } catch (error) {
      this.statusTarget.textContent = error.message
    }
  }

  show(result) {
    const grid = result.portrait.id !== this.current ? decodeGrid(result.portrait.grid) : null
    this.current = result.portrait.id
    this.portrait.morphTo(grid, result.confidence)
    this.statusTarget.textContent = result.source === "jev"
      ? "built from your photo, read by Jev"
      : "model not connected — placeholder reading"
    this.guessesTarget.textContent = formatGuesses(result.guesses)
  }
}
