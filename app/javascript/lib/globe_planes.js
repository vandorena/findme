// Little planes flying great-circle routes a little above the globe, drawn on a 2D canvas laid over
// the WebGL one. They use the same spin and tilt as the shader, so they turn with the Earth, and they
// vanish behind it on the far side. Each plane is a vector silhouette drawn as a fine dot screen of its
// own, denser than the globe's characters, that moves and turns with the plane.
const COUNT = 7
const ALTITUDE = 1.03                 // in globe radii, so they ride just above the surface
const SPEED = 0.1                     // radians of arc per second
const ROUTE_ARC = [0.7, 2.0]          // radians between origin and destination
const TRAIL_STEP = 0.004              // radians of arc between trail samples (about a pixel at full size)
const PITCH = 1.4                  // CSS px between dots; the globe's cells are about 1.9 x 3.1 px
// Top-down airliner silhouette, nose along +x, one unit long. Only the upper half: the path mirrors it.
const HALF = [[0.5, 0], [0.42, 0.045], [0.12, 0.055], [-0.1, 0.46], [-0.2, 0.46], [-0.08, 0.055], [-0.34, 0.045],
  [-0.44, 0.19], [-0.51, 0.19], [-0.47, 0]]
const OUTLINE = [...HALF, ...HALF.slice(1, -1).reverse().map(([x, y]) => [x, -y])]

export class GlobePlanes {
  // isLand(latDeg, lonDeg) keeps take-offs and landings off the water.
  constructor(canvas, tilt, isLand) {
    this.canvas = canvas
    this.isLand = isLand
    this.ctx = canvas.getContext("2d")
    this.cosT = Math.cos(tilt)
    this.sinT = Math.sin(tilt)
    this.size = 0
    this.planes = []
  }

  fit(cssSize, dpr) {
    this.size = cssSize
    this.canvas.width = this.canvas.height = Math.max(1, Math.round(cssSize * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.length = Math.max(7, cssSize / 48)
    // The plane's dot screen, in pixels around its centre with the nose along +x: every point of a
    // PITCH grid that falls inside the silhouette.
    this.dots = []
    const reach = this.length * 0.55
    for (let v = -reach; v <= reach; v += PITCH) {
      for (let u = -reach; u <= reach; u += PITCH) {
        if (inside(OUTLINE, u / this.length, v / this.length)) this.dots.push([u, v])
      }
    }
  }

  // spin turns the Earth about its axis; pitch then tips the whole view about the screen's horizontal axis.
  draw(t, spin, pitch = 0) {
    // Start everyone somewhere mid-flight so the sky isn't empty on load.
    if (!this.planes.length) this.planes = Array.from({ length: COUNT }, () => route(t, Math.random(), this.isLand))
    this.planes = this.planes.map((p) => (t >= p.ends ? route(t, 0, this.isLand) : p))

    const ctx = this.ctx
    const radius = PITCH * 0.36
    ctx.clearRect(0, 0, this.size, this.size)
    this.view = { cosS: Math.cos(spin), sinS: Math.sin(spin), cosP: Math.cos(pitch), sinP: Math.sin(pitch) }

    for (const p of this.planes) {
      // Planes appear the moment they take off and vanish the moment they land: no fading.
      const f = (t - p.starts) / (p.ends - p.starts)
      if (f < 0 || f >= 1) continue

      // The whole way flown so far, from take-off to here, as a dotted line under the plane. It goes when
      // the plane lands, because the route is replaced.
      const trail = []
      let last = null
      const steps = Math.ceil(f * p.arc / TRAIL_STEP)
      for (let i = 0; i <= steps; i++) {
        const s = this.project(p.at(f * i / steps))
        if (!s) { last = null; continue }
        if (last && Math.hypot(s.x - last.x, s.y - last.y) < PITCH * 1.6) continue
        trail.push(s)
        last = s
      }
      ctx.globalAlpha = 0.75
      for (const [color, r] of [["#000000", radius * 0.8 + PITCH * 0.45], ["#cfd6e6", radius * 0.8]]) {
        ctx.fillStyle = color
        ctx.beginPath()
        for (const s of trail) {
          ctx.moveTo(s.x + r, s.y)
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        }
        ctx.fill()
      }

      const here = this.project(p.at(f))
      if (!here) continue
      const ahead = this.project(p.at(Math.min(1, f + 0.01))) || here
      ctx.save()
      ctx.translate(here.x, here.y)
      ctx.rotate(Math.atan2(ahead.y - here.y, ahead.x - here.x))
      ctx.globalAlpha = 1
      // A black halo under the white dots, so the plane stands out on the amber land as well as the sea.
      for (const [color, r] of [["#000000", radius + PITCH * 0.55], ["#ffffff", radius]]) {
        ctx.fillStyle = color
        ctx.beginPath()
        for (const [u, v] of this.dots) {
          ctx.moveTo(u + r, v)
          ctx.arc(u, v, r, 0, Math.PI * 2)
        }
        ctx.fill()
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  // Earth-fixed unit vector -> CSS pixel on the overlay, or null when the globe hides it. This is the
  // forward version of the shader's ray-to-latitude/longitude maths.
  project([ex, ey, ez]) {
    const { cosS, sinS, cosP, sinP } = this.view
    const gx = (ex * cosS + ez * sinS) * ALTITUDE
    const gy = ey * ALTITUDE
    const gz = (-ex * sinS + ez * cosS) * ALTITUDE
    const x = this.cosT * gx - this.sinT * gy
    const ty = this.sinT * gx + this.cosT * gy
    const y = ty * cosP - gz * sinP
    const z = ty * sinP + gz * cosP
    if (z <= 0 && x * x + y * y <= 1) return null
    return { x: (x + 1) / 2 * this.size, y: (1 - y) / 2 * this.size }
  }
}

// A great-circle flight between two random points on land, already `done` of the way along at time t.
function route(t, done, isLand) {
  const from = randomPoint(isLand)
  let to, arc
  do {
    to = randomPoint(isLand)
    arc = Math.acos(Math.max(-1, Math.min(1, dot(from, to))))
  } while (arc < ROUTE_ARC[0] || arc > ROUTE_ARC[1])
  const duration = arc / SPEED
  const starts = t - done * duration
  const sinArc = Math.sin(arc)
  return {
    arc,
    starts,
    ends: starts + duration,
    at(f) {
      const a = Math.sin((1 - f) * arc) / sinArc, b = Math.sin(f * arc) / sinArc
      return [a * from[0] + b * to[0], a * from[1] + b * to[1], a * from[2] + b * to[2]]
    }
  }
}

// A spot on land where people fly: between 55°S and 70°N. About a third of that band is land, so this
// takes a few tries on average.
function randomPoint(isLand) {
  let latDeg, lonDeg
  do {
    latDeg = -55 + Math.random() * 125
    lonDeg = Math.random() * 360 - 180
  } while (!isLand(latDeg, lonDeg))
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function inside(ring, x, y) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
