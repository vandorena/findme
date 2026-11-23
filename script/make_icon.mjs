// Builds the favicon from the globe's own continent outlines: an orthographic view with the same axial
// tilt, sampled onto a coarse dot grid, amber dots for land and dark blue for sea, on black.
// usage: node script/make_icon.mjs app/javascript/controllers/globe_controller.js public/icon.svg public/icon.png 17 -20 512
import fs from "node:fs"
import zlib from "node:zlib"

const [src, outSvg, outPng, nArg, lonArg, sizeArg] = process.argv.slice(2)
const N = Number(nArg || 17)
const LON0 = Number(lonArg || -25) * Math.PI / 180
const SIZE = Number(sizeArg || 512)
const TILT = 23.4 * Math.PI / 180

const code = fs.readFileSync(src, "utf8")
const grab = (name) => {
  const start = code.indexOf(`const ${name} = [`)
  const end = code.indexOf("\n]", start)
  return Function(`return ${code.slice(start + `const ${name} = `.length, end + 2)}`)()
}
const OUTLINES = grab("OUTLINES"), WATER = grab("WATER")

const inside = (ring, lon, lat) => {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
const land = (lon, lat) => OUTLINES.some((r) => inside(r, lon, lat)) && !WATER.some((r) => inside(r, lon, lat))

// Same projection as the shader: p in [-1, 1] with y up, roll by the tilt, read off lat/lon.
const sample = (px, py) => {
  const r2 = px * px + py * py
  if (r2 > 1) return null
  const z = Math.sqrt(1 - r2)
  const gx = px * Math.cos(TILT) + py * Math.sin(TILT)
  const gy = -px * Math.sin(TILT) + py * Math.cos(TILT)
  const lat = Math.asin(Math.max(-1, Math.min(1, gy))) * 180 / Math.PI
  let lon = (Math.atan2(gx, z) + LON0) * 180 / Math.PI
  lon = ((lon + 540) % 360) - 180
  return land(lon, lat)
}

// Each grid cell is land if enough of it is land, so small coasts still show at this resolution.
const cells = []
for (let row = 0; row < N; row++) {
  for (let col = 0; col < N; col++) {
    const cx = (col + 0.5) / N * 2 - 1, cy = 1 - (row + 0.5) / N * 2
    if (cx * cx + cy * cy > 1.0) continue
    let hits = 0, total = 0
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const s = sample(cx + ((i + 0.5) / 5 - 0.5) * 2 / N, cy + ((j + 0.5) / 5 - 0.5) * 2 / N)
      if (s === null) continue
      total++
      if (s) hits++
    }
    cells.push({ row, col, land: total > 0 && hits / total > 0.4 })
  }
}

const AMBER = "#ffb000", SEA = "#2236a8", BG = "#000"
const RADIUS = 0.44 // of the dot pitch
const INSET = 0.05  // margin around the disc, of the icon size
const CORNER = 0.22 // rounded-square corner, of the icon size

// SVG, in a 512 box.
const B = 512, pitchSvg = B * (1 - 2 * INSET) / N, offSvg = B * INSET
const dots = cells.map((c) =>
  `<circle cx="${(offSvg + (c.col + 0.5) * pitchSvg).toFixed(1)}" cy="${(offSvg + (c.row + 0.5) * pitchSvg).toFixed(1)}" r="${(pitchSvg * RADIUS).toFixed(1)}" fill="${c.land ? AMBER : SEA}"/>`)
fs.writeFileSync(outSvg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${B} ${B}">
  <!-- findme: the globe as a dot matrix, amber land on dark blue sea. Generated from the globe's outlines. -->
  <rect width="${B}" height="${B}" rx="${B * CORNER}" fill="${BG}"/>
  ${dots.join("\n  ")}
</svg>
`)

// PNG, rasterised directly with antialiased dots and corners.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const amber = hex(AMBER), sea = hex(SEA)
const grid = new Map(cells.map((c) => [c.row * N + c.col, c.land ? amber : sea]))
const px = Buffer.alloc((SIZE * 4 + 1) * SIZE)
const pitch = SIZE * (1 - 2 * INSET) / N, off = SIZE * INSET, rad = pitch * RADIUS, corner = SIZE * CORNER
for (let y = 0; y < SIZE; y++) {
  px[y * (SIZE * 4 + 1)] = 0
  for (let x = 0; x < SIZE; x++) {
    const fx = x + 0.5, fy = y + 0.5
    // rounded square coverage
    const qx = Math.max(corner - fx, fx - (SIZE - corner), 0), qy = Math.max(corner - fy, fy - (SIZE - corner), 0)
    const bgA = Math.max(0, Math.min(1, corner - Math.hypot(qx, qy) + 0.5))
    let rgb = [0, 0, 0]
    const col = Math.floor((fx - off) / pitch), row = Math.floor((fy - off) / pitch)
    const color = col >= 0 && row >= 0 && col < N && row < N ? grid.get(row * N + col) : undefined
    if (color) {
      const d = Math.hypot(fx - (off + (col + 0.5) * pitch), fy - (off + (row + 0.5) * pitch))
      const a = Math.max(0, Math.min(1, rad - d + 0.5))
      rgb = color.map((c) => c * a)
    }
    const i = y * (SIZE * 4 + 1) + 1 + x * 4
    px[i] = Math.round(rgb[0]); px[i + 1] = Math.round(rgb[1]); px[i + 2] = Math.round(rgb[2]); px[i + 3] = Math.round(bgA * 255)
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6
fs.writeFileSync(outPng, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(px)), chunk("IEND", Buffer.alloc(0))]))
console.log(`${cells.length} dots, ${cells.filter((c) => c.land).length} land`)
