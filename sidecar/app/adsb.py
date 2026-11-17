"""Live ADS-B: one poller per region tile, shared by every session in that tile, plus the track
model the solver needs (1 s cubic-Hermite resampling that uses the reported velocities).

Sources: adsb.lol /v2/point (no key needed as of 2026-11), adsb.fi open data as the fallback.
airplanes.live answers 403 to unregistered clients, so it is not used."""

from __future__ import annotations

import json
import logging
import math
import threading
import time
import urllib.request
from dataclasses import dataclass, field

import numpy as np

from .geo import Frame

log = logging.getLogger(__name__)

FT = 0.3048
KT = 0.514444
FPM = FT / 60

USER_AGENT = "me-audio/0.1 (aircraft-doppler geolocation challenge)"
SOURCES = (
    ("adsblol", "https://api.adsb.lol/v2/point/{lat:.3f}/{lon:.3f}/{nm}"),
    ("adsbfi", "https://opendata.adsb.fi/api/v2/lat/{lat:.3f}/lon/{lon:.3f}/dist/{nm}"),
)

KEEP_S = 30 * 60  # samples older than this are dropped
MAX_GAP_S = 20.0  # a track is not interpolated across a longer gap
IDLE_STOP_S = 180.0  # a tile with no sessions keeps polling this long, so a reload reuses its history

# Turboprops and pistons whose ADS-B category alone may say "large" or nothing at all.
PROP_TYPES = frozenset(
    "AT43 AT44 AT45 AT46 AT72 AT73 AT75 AT76 DH8A DH8B DH8C DH8D DHC6 DHC7 DHC2 DHC3 B350 B190 BE20 BE30 "
    "BE9L BE9T BE99 BE10 BE33 BE35 BE36 BE55 BE58 BE76 C130 C30J C160 C27J CN35 C295 PC12 PC6T PC21 PC7 PC9 "
    "C208 C210 C206 C207 C182 C172 C152 C150 C177 C180 C185 C195 C310 C340 C402 C404 C414 C421 C425 C441 "
    "C212 SF34 SW3 SW4 JS31 JS32 JS41 E110 E120 D228 D328 F27 F50 L410 P180 TBM7 TBM8 TBM9 KODI M600 P46T "
    "PA18 PA22 PA23 PA24 PA28 PA31 PA32 PA34 PA44 PA46 P28A P28B P28R P32R PA38 SR20 SR22 S22T DA40 DA42 "
    "DA62 M20P M20T BN2P AN26 AN28 AN32 Y12 E314 P3 P8 CL2T CL4T AC90 AC95 MU2 G115 GA8 RV7 RV8 RV10 "
    "C72R C82R T206 T210 COUR ULAC GLID".split()
)
HELI_PREFIXES = ("A109", "A119", "A139", "A169", "AS32", "AS35", "AS50", "AS55", "AS65", "B06", "B105",
                 "B212", "B407", "B412", "B429", "B505", "EC20", "EC25", "EC30", "EC35", "EC45", "EC55",
                 "EC75", "H125", "H130", "H135", "H145", "H160", "H175", "R22", "R44", "R66", "S76",
                 "S92", "UH1", "H60", "H47", "MI8", "AW1", "BK17")


def classify(category: str | None, type_code: str | None) -> str:
    t = (type_code or "").upper()
    if category == "A7" or t.startswith(HELI_PREFIXES):
        return "heli"
    if t in PROP_TYPES or category in ("A1", "B1", "B4"):
        return "prop"
    if category in ("A2", "A3", "A4", "A5", "A6") or t:
        return "jet"
    return "unknown"


@dataclass
class Sample:
    t: float  # UTC seconds of the position
    lat: float
    lon: float
    alt_m: float  # geometric (GNSS) altitude when reported, else barometric
    vx: float  # east, m/s
    vy: float  # north, m/s
    vz: float  # up, m/s


@dataclass
class Aircraft:
    hex: str
    callsign: str = ""
    type_code: str = ""
    kind: str = "unknown"
    samples: list[Sample] = field(default_factory=list)


def parse_aircraft(ac: dict, now: float) -> tuple[dict, Sample] | None:
    """One /v2 aircraft record -> (identity, sample), or None when it is on the ground or unusable."""
    if "lat" not in ac or "lon" not in ac or ac.get("alt_baro") == "ground":
        return None
    alt = ac.get("alt_geom", ac.get("alt_baro"))
    gs, trk = ac.get("gs"), ac.get("track", ac.get("true_heading"))
    if not isinstance(alt, (int, float)) or gs is None or trk is None:
        return None
    kind = classify(ac.get("category"), ac.get("t"))
    if gs < (20 if kind == "heli" else 40):  # taxiing or hovering: no usable Doppler
        return None
    rate = ac.get("geom_rate", ac.get("baro_rate")) or 0
    rad = math.radians(trk)
    ident = {"hex": ac["hex"].lower(), "callsign": (ac.get("flight") or "").strip(),
             "type_code": ac.get("t") or "", "kind": kind}
    sample = Sample(t=now - float(ac.get("seen_pos", 0.0)), lat=float(ac["lat"]), lon=float(ac["lon"]),
                    alt_m=float(alt) * FT, vx=gs * KT * math.sin(rad), vy=gs * KT * math.cos(rad),
                    vz=float(rate) * FPM)
    return ident, sample


class Tile:
    """Every aircraft seen around one point. Thread-safe; the poller and synthetic tests both feed it."""

    def __init__(self, lat: float, lon: float, radius_km: float):
        self.lat, self.lon, self.radius_km = lat, lon, radius_km
        self.aircraft: dict[str, Aircraft] = {}
        self.lock = threading.Lock()
        self.users = 0
        self.released_at = time.time()
        self.last_ok: float | None = None
        self.source: str | None = None
        self.error: str | None = None

    def add(self, ident: dict, sample: Sample) -> None:
        with self.lock:
            a = self.aircraft.get(ident["hex"])
            if a is None:
                a = self.aircraft[ident["hex"]] = Aircraft(ident["hex"])
            a.callsign = ident["callsign"] or a.callsign
            a.type_code = ident["type_code"] or a.type_code
            a.kind = ident["kind"]
            if a.samples and abs(a.samples[-1].t - sample.t) < 0.2:
                return  # same position reported again
            a.samples.append(sample)
            if len(a.samples) > 1 and a.samples[-2].t > sample.t:
                a.samples.sort(key=lambda s: s.t)

    def prune(self, now: float) -> None:
        with self.lock:
            for key in list(self.aircraft):
                a = self.aircraft[key]
                a.samples = [s for s in a.samples if now - s.t < KEEP_S]
                if not a.samples:
                    del self.aircraft[key]

    def snapshot(self) -> list[Aircraft]:
        with self.lock:
            return [Aircraft(a.hex, a.callsign, a.type_code, a.kind, list(a.samples)) for a in self.aircraft.values()]

    def ingest(self, payload: dict, received_at: float) -> int:
        now = payload.get("now")
        now = now / 1000 if now and now > 1e11 else (now or received_at)  # adsb.lol ms, adsb.fi s
        records = payload.get("ac") or payload.get("aircraft") or []
        n = 0
        for ac in records:
            parsed = parse_aircraft(ac, now)
            if parsed:
                self.add(*parsed)
                n += 1
        return n


class TilePoller:
    """Owns the live tiles. A session acquires the tile around its prior and releases it when done."""

    def __init__(self, period_s: float = 2.0, offline: bool = False):
        self.period_s = period_s
        self.offline = offline
        self.tiles: dict[tuple, Tile] = {}
        self.lock = threading.Lock()

    @staticmethod
    def key(lat: float, lon: float, radius_km: float) -> tuple:
        return round(lat * 2) / 2, round(lon * 2) / 2, int(math.ceil(radius_km / 25) * 25)

    def acquire(self, lat: float, lon: float, radius_km: float) -> Tile:
        k = self.key(lat, lon, radius_km)
        with self.lock:
            tile = self.tiles.get(k)
            if tile is None:
                # The tile is centred on its rounded key, so widen it to still cover the whole prior.
                tile = self.tiles[k] = Tile(k[0], k[1], k[2] + 45)
                if not self.offline:
                    threading.Thread(target=self._run, args=(k, tile), daemon=True, name=f"adsb-{k}").start()
            tile.users += 1
            return tile

    def release(self, tile: Tile) -> None:
        with self.lock:
            tile.users = max(0, tile.users - 1)
            tile.released_at = time.time()

    def _run(self, key: tuple, tile: Tile) -> None:
        nm = min(250, int(math.ceil(tile.radius_km / 1.852)))
        backoff = self.period_s
        while True:
            with self.lock:
                if tile.users == 0 and time.time() - tile.released_at > IDLE_STOP_S:
                    del self.tiles[key]
                    return
            started = time.time()
            for name, template in SOURCES:
                try:
                    payload = fetch_json(template.format(lat=tile.lat, lon=tile.lon, nm=nm))
                    tile.ingest(payload, time.time())
                    tile.last_ok, tile.source, tile.error = time.time(), name, None
                    backoff = self.period_s
                    break
                except Exception as e:  # noqa: BLE001 -- any failure falls through to the next source
                    tile.error = f"{name}: {e}"
            else:
                backoff = min(30.0, backoff * 2)
                log.warning("adsb poll failed for %s: %s", key, tile.error)
            tile.prune(time.time())
            time.sleep(max(0.0, backoff - (time.time() - started)))


def fetch_json(url: str, timeout: float = 8.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


# ---------------------------------------------------------------- track model


@dataclass
class Track:
    """One aircraft resampled to 1 s in a session's local frame. Rows are only where interpolation is safe."""

    hex: str
    callsign: str
    type_code: str
    kind: str
    t: np.ndarray  # UTC seconds, step 1, contiguous
    pos: np.ndarray  # (n, 3) x east, y north, z altitude (m)
    vel: np.ndarray  # (n, 3)

    def segment_ok(self) -> bool:
        return len(self.t) >= 10

    def at(self, times: np.ndarray, velocity: bool = True):
        """Linear interpolation between the 1 s Hermite rows. NaN outside the covered span."""
        flat = np.asarray(times, np.float64).ravel()
        bad = (flat < self.t[0]) | (flat > self.t[-1])
        cols = [self.pos] + ([self.vel] if velocity else [])
        out = []
        for arr in cols:
            m = np.empty((flat.size, 3))
            for k in range(3):
                m[:, k] = np.interp(flat, self.t, arr[:, k])
            m[bad] = np.nan
            out.append(m.reshape(*np.shape(times), 3))
        return out if velocity else out[0]


def build_tracks(aircraft: list[Aircraft], frame: Frame, t_min: float, t_max: float) -> list[Track]:
    """Hermite-resample every aircraft to 1 s over [t_min, t_max], keeping the longest gap-free run."""
    tracks = []
    for a in aircraft:
        s = [x for x in a.samples if t_min - MAX_GAP_S <= x.t <= t_max + MAX_GAP_S]
        if len(s) < 2:
            continue
        ts = np.array([x.t for x in s])
        x, y = frame.to_xy(np.array([v.lat for v in s]), np.array([v.lon for v in s]))
        p = np.column_stack([x, y, [v.alt_m for v in s]])
        v = np.array([[q.vx, q.vy, q.vz] for q in s])
        # longest run without a gap
        cuts = np.nonzero(np.diff(ts) > MAX_GAP_S)[0] + 1
        runs = np.split(np.arange(len(ts)), cuts)
        run = max(runs, key=lambda r: ts[r[-1]] - ts[r[0]])
        if len(run) < 2:
            continue
        ts, p, v = ts[run], p[run], v[run]
        grid = np.arange(math.ceil(max(ts[0], t_min - MAX_GAP_S)), math.floor(min(ts[-1], t_max + MAX_GAP_S)) + 1.0)
        if len(grid) < 10:
            continue
        pos, _ = hermite(ts, p, v, grid)
        # Velocity from the reports themselves (smoothed by the avionics), not from differentiating
        # positions whose timestamps are only good to ~0.1 s.
        vel = np.column_stack([np.interp(grid, ts, v[:, k]) for k in range(3)])
        tracks.append(Track(a.hex, a.callsign, a.type_code, a.kind, grid, pos, vel))
    return tracks


def hermite(ts: np.ndarray, p: np.ndarray, v: np.ndarray, grid: np.ndarray):
    j = np.clip(np.searchsorted(ts, grid, side="right") - 1, 0, len(ts) - 2)
    h = (ts[j + 1] - ts[j])[:, None]
    s = (grid - ts[j])[:, None] / h
    s2, s3 = s * s, s * s * s
    h00, h10, h01, h11 = 2 * s3 - 3 * s2 + 1, s3 - 2 * s2 + s, -2 * s3 + 3 * s2, s3 - s2
    d00, d10, d01, d11 = 6 * s2 - 6 * s, 3 * s2 - 4 * s + 1, -6 * s2 + 6 * s, 3 * s2 - 2 * s
    p0, p1, v0, v1 = p[j], p[j + 1], v[j], v[j + 1]
    pos = h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1
    vel = (d00 * p0 + d10 * h * v0 + d01 * p1 + d11 * h * v1) / h
    return pos, vel
