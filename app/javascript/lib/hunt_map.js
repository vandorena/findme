// The map: the IP prior, aircraft tracks near the visitor, the solver's heatmap, our guess, and the
// visitor's pin. OpenStreetMap tiles, inverted to match the page.
import * as L from "leaflet"

const AMBER = "#ffb000"
const DIM = "#8a8a8a"

export class HuntMap {
  constructor(element) {
    this.map = L.map(element, { zoomControl: true, attributionControl: true, worldCopyJump: true })
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      className: "osm-tiles",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map)
    this.map.setView([20, 0], 2)
    this.tracks = L.layerGroup().addTo(this.map)
  }

  showPrior({ lat, lon, radius_km }) {
    this.prior?.remove()
    this.prior = L.circle([lat, lon], { radius: radius_km * 1000, color: DIM, weight: 1, dashArray: "4 4", fill: false })
      .addTo(this.map)
    this.map.fitBounds(this.prior.getBounds(), { padding: [12, 12] })
  }

  update(snapshot) {
    this.tracks.clearLayers()
    const heard = new Set((snapshot.heard || []).map((a) => a.hex))
    for (const track of snapshot.tracks || []) {
      if (track.path.length < 2) continue
      const loud = heard.has(track.hex)
      L.polyline(track.path, { color: loud ? AMBER : DIM, weight: loud ? 2.5 : 1, opacity: loud ? 1 : 0.6 })
        .bindTooltip(`${track.callsign || track.hex} · ${track.type || track.kind}`)
        .addTo(this.tracks)
    }
    this.showHeatmap(snapshot.heatmap)
    if (snapshot.tier === "doppler" && snapshot.guess) this.showGuess(snapshot.guess, false)
  }

  showHeatmap(heatmap) {
    this.heat?.remove()
    this.heat = null
    if (!heatmap) return
    const { width, height, data, bounds } = heatmap
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    const image = ctx.createImageData(width, height)
    for (let i = 0; i < bytes.length; i++) {
      const v = bytes[i] / 255
      image.data[i * 4] = 255
      image.data[i * 4 + 1] = 176
      image.data[i * 4 + 2] = 0
      image.data[i * 4 + 3] = Math.round(255 * Math.pow(v, 1.5) * (heatmap.heard ? 0.75 : 0.35))
    }
    ctx.putImageData(image, 0, 0)
    this.heat = L.imageOverlay(canvas.toDataURL(), bounds, { className: "heatmap", interactive: false }).addTo(this.map)
  }

  showGuess({ lat, lon, radius_m }, fit = true) {
    this.guess?.remove()
    this.guess = L.layerGroup([
      L.circle([lat, lon], { radius: radius_m, color: AMBER, weight: 1, fillOpacity: 0.08 }),
      L.circleMarker([lat, lon], { radius: 5, color: AMBER, fillColor: AMBER, fillOpacity: 1 })
        .bindTooltip("our guess", { permanent: true, direction: "right", className: "map-label" })
    ]).addTo(this.map)
    if (fit) this.map.fitBounds(L.latLng(lat, lon).toBounds(2 * Math.max(radius_m, 1500)))
  }

  showAnswer({ lat, lon }) {
    L.circleMarker([lat, lon], { radius: 5, color: "#fff", weight: 1, fillOpacity: 0 })
      .bindTooltip("test flight's answer", { direction: "right", className: "map-label" })
      .addTo(this.map)
  }

  // Lets the visitor click where they really are. onPin({ lat, lon })
  askForPin(onPin) {
    this.map.getContainer().classList.add("pinning")
    this.map.on("click", (event) => {
      const { lat, lng } = event.latlng.wrap()
      this.pin?.remove()
      this.pin = L.circleMarker([lat, lng], { radius: 6, color: "#fff", fillColor: "#fff", fillOpacity: 1 })
        .bindTooltip("you", { permanent: true, direction: "right", className: "map-label" })
        .addTo(this.map)
      onPin({ lat, lon: lng })
    })
  }

  stopPinning() {
    this.map.off("click")
    this.map.getContainer().classList.remove("pinning")
  }

  connectPin({ lat, lon }, guess) {
    if (!guess) return
    L.polyline([[lat, lon], [guess.lat, guess.lon]], { color: "#fff", weight: 1, dashArray: "2 4" }).addTo(this.map)
  }

  invalidate() {
    this.map.invalidateSize()
  }
}
