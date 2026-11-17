"""Mains hum: is the room on a 50 Hz or a 60 Hz grid? Laptop mics often lose the fundamental, so the
harmonics count as much as the fundamental itself. Needs no aircraft and works indoors."""

from __future__ import annotations

import numpy as np

from .spectro import FS

WINDOW_S = 20.0
HARMONICS = 5  # 50..250 Hz or 60..300 Hz
MIN_PROMINENCE_DB = 6.0
MIN_HITS = 2

# Grids that run at 60 Hz. Everything else in ISO 3166 runs at 50 Hz (Japan is split: east 50, west 60).
SIXTY_HZ = frozenset(
    "US CA MX GT BZ SV HN NI CR PA CU DO HT PR BS BM KY TC AG KN LC VC VG VI AW CW BQ SX TT GU AS MP FM MH PW "
    "CO VE EC PE GY SR BR SA TW KR PH LR".split()
)


def expected_hz(country_code: str | None) -> int | None:
    if not country_code:
        return None
    if country_code.upper() == "JP":
        return None
    return 60 if country_code.upper() in SIXTY_HZ else 50


def detect(audio: np.ndarray, fs: int = FS) -> dict | None:
    """Returns {"hz": 50|60, "fundamental": measured Hz, "prominence_db": ..., "harmonics": n} or None."""
    n = int(WINDOW_S * fs)
    x = audio[-n:].astype(np.float64)
    if len(x) < 5 * fs or not np.any(x):
        return None
    # Welch average of 4 s segments: a single long periodogram has enough random peaks to fake a hum.
    seg = 4 * fs
    starts = range(0, len(x) - seg + 1, seg // 2)
    win = np.hanning(seg)
    spec = np.mean([np.abs(np.fft.rfft((x[a:a + seg] - x[a:a + seg].mean()) * win)) ** 2 for a in starts], axis=0)
    f = np.fft.rfftfreq(seg, 1 / fs)
    db = 10 * np.log10(spec + 1e-20)
    results = {}
    for base in (50, 60):
        hits, prom, fund = 0, [], []
        for h in range(1, HARMONICS + 1):
            target = base * h
            peak = (f > target - 0.3 - 0.05 * h) & (f < target + 0.3 + 0.05 * h)
            ring = ((f > target - 4) & (f < target - 1.5)) | ((f > target + 1.5) & (f < target + 4))
            if not peak.any() or not ring.any():
                continue
            i = np.nonzero(peak)[0][db[peak].argmax()]
            p = db[i] - np.median(db[ring])
            if p >= MIN_PROMINENCE_DB:
                hits += 1
                prom.append(p)
                fund.append(f[i] / h)
        results[base] = (hits, float(np.mean(prom)) if prom else 0.0, float(np.median(fund)) if fund else None)
    best = max(results, key=lambda b: (results[b][0], results[b][1]))
    hits, prom, fund = results[best]
    other = results[110 - best]
    if hits < MIN_HITS or (other[0] >= hits and other[1] >= prom):
        return None
    return {"hz": best, "fundamental": round(fund, 3), "prominence_db": round(prom, 1), "harmonics": hits}
