import { Controller } from "@hotwired/stimulus"

// The night sky behind the page: scattered ASCII stars that twinkle, and now and then a shooting star.
const STAR_CHARS = [".", ".", ".", "'", "+", "*"]
const AREA_PER_STAR = 5000          // CSS px² of sky per star
const MAX_STARS = 500
const FONT_PX = 12
const SHOOTER_GAP_S = [2, 7]        // seconds between shooting stars
const SHOOTER_SPEED = [500, 900]    // CSS px per second
const SHOOTER_LIFE_S = [0.7, 1.3]
const TRAIL = 14                    // characters behind the head
const TRAIL_STEP = 9                // CSS px between trail characters

export default class extends Controller {
  connect() {
    this.ctx = this.element.getContext("2d")
    this.stars = []
    this.shooters = []
    this.still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.onResize = () => this.fit()
    window.addEventListener("resize", this.onResize)
    this.fit()
    if (this.still) return this.draw(0)
    this.nextShooter = performance.now() / 1000 + between(SHOOTER_GAP_S)
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop)
      this.draw(now / 1000)
    }
    this.raf = requestAnimationFrame(loop)
  }

  disconnect() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener("resize", this.onResize)
  }

  fit() {
    const dpr = window.devicePixelRatio || 1
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.element.width = Math.round(this.w * dpr)
    this.element.height = Math.round(this.h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const count = Math.min(MAX_STARS, Math.round(this.w * this.h / AREA_PER_STAR))
    this.stars = Array.from({ length: count }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      ch: STAR_CHARS[Math.floor(Math.random() * STAR_CHARS.length)],
      peak: between([0.35, 1]),
      speed: between([0.6, 2.5]),     // radians per second
      phase: Math.random() * Math.PI * 2
    }))
    if (this.still) this.draw(0)
  }

  draw(t) {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.w, this.h)
    ctx.font = `${FONT_PX}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    ctx.fillStyle = "#dfe6ff"
    for (const s of this.stars) {
      // Mostly steady with a sharp dip now and then, which reads more like twinkling than a slow pulse.
      const wave = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase)
      ctx.globalAlpha = this.still ? s.peak * 0.7 : s.peak * (0.15 + 0.85 * wave ** 3)
      ctx.fillText(s.ch, s.x, s.y)
    }

    if (!this.still) this.drawShooters(t)
    ctx.globalAlpha = 1
  }

  drawShooters(t) {
    if (t >= this.nextShooter) {
      this.shooters.push(this.launch(t))
      this.nextShooter = t + between(SHOOTER_GAP_S)
    }
    const ctx = this.ctx
    this.shooters = this.shooters.filter((s) => t - s.born < s.life)
    for (const s of this.shooters) {
      const age = t - s.born
      const fade = Math.min(1, age / 0.15, (s.life - age) / 0.3)
      const hx = s.x + s.dx * s.speed * age
      const hy = s.y + s.dy * s.speed * age
      ctx.fillStyle = "#fff6d8"
      for (let i = TRAIL; i >= 1; i--) {
        ctx.globalAlpha = fade * (1 - i / (TRAIL + 1)) * 0.8
        ctx.fillText(i < 3 ? "=" : s.trail, hx - s.dx * TRAIL_STEP * i, hy - s.dy * TRAIL_STEP * i)
      }
      ctx.globalAlpha = fade
      ctx.fillStyle = "#ffffff"
      ctx.fillText("*", hx, hy)
    }
  }

  launch(t) {
    // Start somewhere along the top or a side and fall at 15-45 degrees.
    const right = Math.random() < 0.5
    const angle = between([15, 45]) * Math.PI / 180
    const dx = Math.cos(angle) * (right ? 1 : -1)
    const dy = Math.sin(angle)
    return {
      x: right ? between([-0.1, 0.6]) * this.w : between([0.4, 1.1]) * this.w,
      y: between([-0.05, 0.4]) * this.h,
      dx, dy,
      speed: between(SHOOTER_SPEED),
      life: between(SHOOTER_LIFE_S),
      born: t,
      trail: angle < 30 * Math.PI / 180 ? "-" : right ? "\\" : "/"
    }
  }
}

function between([lo, hi]) {
  return lo + Math.random() * (hi - lo)
}
