import { Controller } from "@hotwired/stimulus"

// The footer's credits, popped up from a corner button while a hunt is live (the CSS decides when the button
// shows). A click anywhere else, or Escape, puts them away again.
export default class extends Controller {
  static targets = ["toggle"]

  toggle() {
    this.set(!this.element.classList.contains("open"))
  }

  close() {
    this.set(false)
  }

  outside(event) {
    if (!this.element.contains(event.target)) this.close()
  }

  set(open) {
    this.element.classList.toggle("open", open)
    this.toggleTarget.setAttribute("aria-expanded", open)
  }
}
