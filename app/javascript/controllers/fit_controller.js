import { Controller } from "@hotwired/stimulus"

// Gives the globe exactly the height the intro has left once the sign, subtitle and controls are laid out,
// as --globe-max on the intro. A fixed guess in CSS can't know how tall the footer and subtitle wrap to on
// a narrow screen, and on phones that pushed the controls under the footnote.
export default class extends Controller {
  static targets = ["globe"]

  connect() {
    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(this.element.parentElement) // the hunt column: viewport minus footer
    for (const child of this.element.children) if (child !== this.globeTarget) this.resize.observe(child)
  }

  disconnect() {
    this.resize?.disconnect()
  }

  fit() {
    const column = this.element.parentElement
    const style = getComputedStyle(column)
    const room = column.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    const rest = this.element.offsetHeight - this.globeTarget.offsetHeight
    this.element.style.setProperty("--globe-max", `${Math.max(120, Math.floor(room - rest))}px`)
  }
}
