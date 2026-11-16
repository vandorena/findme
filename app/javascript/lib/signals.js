// One-off snapshot of what the browser reveals without asking permission.
// Every slow probe is capped so collection never holds up the first portrait.

const PROBE_FONTS = [
  "Fira Code", "JetBrains Mono", "Cascadia Code", "Source Code Pro", "Hack",
  "Helvetica Neue", "Futura", "Avenir", "Proxima Nova", "Gotham", "Inter",
  "Calibri", "Segoe UI", "Ubuntu", "Roboto", "PingFang SC", "Hiragino Sans", "Malgun Gothic", "Noto Sans Devanagari"
]

function capped(promise, ms, fallback = null) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ])
}

function gpu() {
  try {
    const gl = document.createElement("canvas").getContext("webgl")
    const info = gl.getExtension("WEBGL_debug_renderer_info")
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  } catch {
    return null
  }
}

// A font is present if text set in it measures differently from the fallback.
function fonts() {
  try {
    const context = document.createElement("canvas").getContext("2d")
    const sample = "mmmmmmmmmwwwwwlli10O"
    const width = (family) => {
      context.font = `72px ${family}`
      return context.measureText(sample).width
    }
    const bases = ["monospace", "serif"]
    const baseline = bases.map(width)
    return PROBE_FONTS.filter((font) => bases.some((base, i) => width(`"${font}", ${base}`) !== baseline[i]))
  } catch {
    return []
  }
}

function refreshRate() {
  return new Promise((resolve) => {
    const stamps = []
    const tick = (now) => {
      stamps.push(now)
      if (stamps.length < 8) return requestAnimationFrame(tick)
      const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b)
      resolve(Math.round(1000 / gaps[Math.floor(gaps.length / 2)]))
    }
    requestAnimationFrame(tick)
  })
}

function adblock() {
  const bait = document.createElement("div")
  bait.className = "adsbox ad-banner ad-placement"
  bait.style.cssText = "position:absolute;left:-999px;height:10px;width:10px"
  document.body.appendChild(bait)
  const blocked = bait.offsetHeight === 0
  bait.remove()
  return blocked
}

async function battery() {
  if (!navigator.getBattery) return null
  const b = await navigator.getBattery()
  return { level: b.level, charging: b.charging }
}

async function uaData() {
  if (!navigator.userAgentData) return null
  const high = await navigator.userAgentData.getHighEntropyValues(["platformVersion", "model", "architecture"])
  return {
    platform: high.platform,
    platformVersion: high.platformVersion,
    model: high.model,
    architecture: high.architecture,
    mobile: high.mobile
  }
}

export async function collectSignals() {
  const [hints, power, hz] = await Promise.all([
    capped(uaData(), 60),
    capped(battery(), 60),
    capped(refreshRate(), 150)
  ])
  const now = new Date()
  const connection = navigator.connection

  return {
    ua: navigator.userAgent,
    uaData: hints,
    gpu: gpu(),
    cores: navigator.hardwareConcurrency ?? null,
    memory: navigator.deviceMemory ?? null,
    touchPoints: navigator.maxTouchPoints ?? 0,
    screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio, depth: screen.colorDepth },
    window: { w: window.innerWidth, h: window.innerHeight },
    hz,
    darkMode: matchMedia("(prefers-color-scheme: dark)").matches,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    languages: [...(navigator.languages ?? [navigator.language])],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localTime: { hour: now.getHours(), minute: now.getMinutes(), weekday: now.getDay() },
    dnt: navigator.doNotTrack === "1",
    adblock: adblock(),
    fonts: fonts(),
    referrer: document.referrer ? new URL(document.referrer).hostname : null,
    connection: connection ? { type: connection.effectiveType, downlink: connection.downlink } : null,
    battery: power,
    gamepads: [...(navigator.getGamepads?.() ?? [])].filter(Boolean).map((pad) => pad.id)
  }
}
