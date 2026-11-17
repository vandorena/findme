"""Streaming log-frequency spectrogram and its whitened form (after colsto-leak-and-mask's ridge.py).

Audio arrives as 8 kHz mono in 5 s chunks. Each full STFT frame is computed once; whitening is redone
over the whole session each tick (a few thousand frames by a few hundred bins, so it is cheap)."""

from __future__ import annotations

import math

import numpy as np

FS = 8000
NPERSEG = 8192  # ~1 Hz resolution, enough to see a 1 % Doppler step at 100 Hz
HOP = 2000  # 0.25 s
FMIN, FMAX = 45.0, 1400.0
DLOG = 0.01  # log-frequency bin: 1 %


def log_bins():
    k = int(round(math.log(FMAX / FMIN) / DLOG)) + 1
    return FMIN * np.exp(DLOG * np.arange(k))


class Spectrogram:
    def __init__(self):
        self.fk = log_bins()
        self.window = np.hanning(NPERSEG).astype(np.float32)
        flin = np.fft.rfftfreq(NPERSEG, 1 / FS)
        lo, hi = self.fk * math.exp(-DLOG / 2), self.fk * math.exp(DLOG / 2)
        # Each log bin takes the max of the FFT bins inside it, or interpolates when it is narrower than one.
        self.groups = []
        for k, f in enumerate(self.fk):
            sel = np.nonzero((flin >= lo[k]) & (flin < hi[k]))[0]
            if len(sel):
                self.groups.append(("max", sel))
            else:
                j = int(np.searchsorted(flin, f) - 1)
                self.groups.append(("lerp", (j, (f - flin[j]) / (flin[j + 1] - flin[j]))))
        self.audio = np.zeros(0, np.float32)
        self.t0: float | None = None  # UTC of audio[0]
        self.rows: list[np.ndarray] = []

    @property
    def duration(self) -> float:
        return len(self.audio) / FS

    def frame_times(self) -> np.ndarray:
        """UTC of each frame's centre."""
        return self.t0 + (np.arange(len(self.rows)) * HOP + NPERSEG / 2) / FS

    def append(self, pcm: np.ndarray, t_utc: float) -> None:
        """Adds a chunk. Gaps up to 30 s are filled with silence so sample index stays tied to UTC."""
        pcm = pcm.astype(np.float32)
        if self.t0 is None:
            self.t0 = t_utc
        else:
            gap = int(round((t_utc - (self.t0 + self.duration)) * FS))
            if 0 < gap <= 30 * FS:
                self.audio = np.concatenate([self.audio, np.zeros(gap, np.float32)])
            elif gap < 0:  # overlaps (clock jitter): drop the overlap
                pcm = pcm[min(len(pcm), -gap):]
        self.audio = np.concatenate([self.audio, pcm])
        self._compute()

    def _compute(self) -> None:
        n_total = 1 + (len(self.audio) - NPERSEG) // HOP if len(self.audio) >= NPERSEG else 0
        start = len(self.rows)
        if n_total <= start:
            return
        idx = np.arange(NPERSEG)[None, :] + HOP * np.arange(start, n_total)[:, None]
        power = np.abs(np.fft.rfft(self.audio[idx] * self.window, axis=1)) ** 2
        lp = 10 * np.log10(power + 1e-12)
        out = np.empty((len(lp), len(self.fk)), np.float32)
        for k, (mode, g) in enumerate(self.groups):
            if mode == "max":
                out[:, k] = lp[:, g].max(axis=1)
            else:
                j, w = g
                out[:, k] = (1 - w) * lp[:, j] + w * lp[:, j + 1]
        self.rows.extend(out)

    def log_power(self) -> np.ndarray:
        return np.array(self.rows, np.float32) if self.rows else np.zeros((0, len(self.fk)), np.float32)

    def whitened(self) -> np.ndarray:
        return whiten(self.log_power())


def whiten(lp: np.ndarray) -> np.ndarray:
    """Removes the per-frequency background and per-frame level so a moving tone stands out, and
    stationary hum (fridges, mains, fans) sits near zero."""
    if len(lp) == 0:
        return lp
    out = lp - np.median(lp, axis=0, keepdims=True)
    med = np.median(out, axis=1, keepdims=True)
    mad = np.median(np.abs(out - med), axis=1, keepdims=True) * 1.4826 + 1e-6
    w = np.clip((out - med) / mad, -3, 6)
    # +-1 bin tolerance for model error
    w = np.maximum(w, np.maximum(np.roll(w, 1, axis=1), np.roll(w, -1, axis=1)))
    return (w - w.mean()).astype(np.float32)
