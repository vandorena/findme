"""Ground elevation from Copernicus GLO-90 (public AWS bucket), fetched per 1x1 degree tile on first use
and cached on disk. Sea and missing tiles read as 0 m. 90 m is plenty: the solver's finest grid is 100 m."""

from __future__ import annotations

import logging
import math
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

URL = ("https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
       "Copernicus_DSM_COG_30_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")


class Dem:
    def __init__(self, cache_dir: str | os.PathLike | None, offline: bool = False):
        self.cache = Path(cache_dir) if cache_dir else None
        self.offline = offline
        self.tiles: dict[tuple[int, int], np.ndarray | None] = {}
        self.lock = threading.Lock()

    def elevation(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        lat, lon = np.asarray(lat, float), np.asarray(lon, float)
        out = np.zeros(lat.shape)
        la, lo = np.floor(lat).astype(int), np.floor(lon).astype(int)
        for key in set(zip(la.ravel().tolist(), lo.ravel().tolist())):
            grid = self.tile(*key)
            if grid is None:
                continue
            sel = (la == key[0]) & (lo == key[1])
            n_rows, n_cols = grid.shape
            # row 0 is the tile's north edge
            r = (key[0] + 1 - lat[sel]) * (n_rows - 1)
            c = (lon[sel] - key[1]) * (n_cols - 1)
            r0 = np.clip(np.floor(r).astype(int), 0, n_rows - 2)
            c0 = np.clip(np.floor(c).astype(int), 0, n_cols - 2)
            fr, fc = r - r0, c - c0
            out[sel] = (grid[r0, c0] * (1 - fr) * (1 - fc) + grid[r0 + 1, c0] * fr * (1 - fc)
                        + grid[r0, c0 + 1] * (1 - fr) * fc + grid[r0 + 1, c0 + 1] * fr * fc)
        return out

    def tile(self, lat: int, lon: int) -> np.ndarray | None:
        with self.lock:
            if (lat, lon) in self.tiles:
                return self.tiles[(lat, lon)]
            grid = None if self.offline else self._load(lat, lon)
            self.tiles[(lat, lon)] = grid
            return grid

    def _load(self, lat: int, lon: int) -> np.ndarray | None:
        name = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
        path = self.cache / f"{name}.npy" if self.cache else None
        if path and path.exists():
            return np.load(path)
        url = URL.format(ns="N" if lat >= 0 else "S", lat=abs(lat), ew="E" if lon >= 0 else "W", lon=abs(lon))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "me-audio/0.1"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):  # no tile: open sea
                grid = np.zeros((2, 2), np.float32)
                if path:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    np.save(path, grid)
                return grid
            log.warning("DEM %s: %s", name, e)
            return None
        except OSError as e:
            log.warning("DEM %s: %s", name, e)
            return None
        import io

        import tifffile

        grid = tifffile.imread(io.BytesIO(raw)).astype(np.float32)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            np.save(path, grid)
        return grid


def tiles_for_circle(lat: float, lon: float, radius_km: float) -> list[tuple[int, int]]:
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(0.1, math.cos(math.radians(lat))))
    return [(a, b) for a in range(math.floor(lat - dlat), math.floor(lat + dlat) + 1)
            for b in range(math.floor(lon - dlon), math.floor(lon + dlon) + 1)]
