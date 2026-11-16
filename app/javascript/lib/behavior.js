// Rolling summary of how the visitor moves, scrolls and types. Only timing
// and geometry are kept; typed characters are never read.
export class BehaviorTracker {
  constructor(typingTarget) {
    this.typingTarget = typingTarget
    this.startedAt = performance.now()
    this.dirty = false
    this.pointer = { samples: 0, distance: 0, time: 0, turn: 0, last: null, lastAngle: null }
    this.scroll = { wheel: 0, trackpad: 0, touch: 0 }
    this.typing = { keys: 0, intervals: 0, backspaces: 0, last: null }
    this.blurs = 0
    this.gamepadActive = false
  }

  start() {
    addEventListener("pointermove", (e) => this.onPointer(e), { passive: true })
    addEventListener("wheel", (e) => this.onWheel(e), { passive: true })
    addEventListener("touchmove", () => this.bump(this.scroll, "touch"), { passive: true })
    addEventListener("blur", () => { this.blurs++; this.dirty = true })
    addEventListener("gamepadconnected", () => { this.gamepadActive = true; this.dirty = true })
    this.typingTarget?.addEventListener("keydown", (e) => this.onKey(e))
  }

  bump(object, key) {
    object[key]++
    this.dirty = true
  }

  onPointer(event) {
    if (event.pointerType === "touch") return
    const p = this.pointer
    const now = event.timeStamp
    if (p.last && now - p.last.t < 200) {
      const dx = event.clientX - p.last.x
      const dy = event.clientY - p.last.y
      const step = Math.hypot(dx, dy)
      if (step > 2) {
        const angle = Math.atan2(dy, dx)
        if (p.lastAngle !== null) {
          const delta = Math.abs(Math.atan2(Math.sin(angle - p.lastAngle), Math.cos(angle - p.lastAngle)))
          p.turn += delta
        }
        p.lastAngle = angle
        p.distance += step
        p.time += now - p.last.t
        p.samples++
        this.dirty = true
      }
    } else {
      p.lastAngle = null
    }
    p.last = { x: event.clientX, y: event.clientY, t: now }
  }

  // Mouse wheels send large whole-number steps; trackpads send a stream of small ones.
  onWheel(event) {
    const delta = Math.abs(event.deltaY)
    const notched = event.deltaMode !== 0 || (delta >= 50 && Number.isInteger(delta))
    this.bump(this.scroll, notched ? "wheel" : "trackpad")
  }

  onKey(event) {
    const t = this.typing
    if (event.key === "Backspace") t.backspaces++
    if (t.last !== null && event.timeStamp - t.last < 2000) t.intervals += event.timeStamp - t.last
    t.last = event.timeStamp
    t.keys++
    this.dirty = true
  }

  summary() {
    this.dirty = false
    const p = this.pointer
    const scrollKind = Object.entries(this.scroll).sort((a, b) => b[1] - a[1])[0]
    return {
      seconds: Math.round((performance.now() - this.startedAt) / 1000),
      pointer: {
        samples: p.samples,
        avgSpeed: p.time > 0 ? (p.distance / p.time) * 1000 : null,
        turniness: p.samples > 0 ? p.turn / p.samples : null
      },
      scroll: { kind: scrollKind[1] > 2 ? scrollKind[0] : null },
      typing: {
        keys: this.typing.keys,
        meanIntervalMs: this.typing.keys > 1 ? this.typing.intervals / (this.typing.keys - 1) : null,
        backspaces: this.typing.backspaces
      },
      blurs: this.blurs,
      gamepadActive: this.gamepadActive
    }
  }
}
