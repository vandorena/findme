# Handoff: `audio` branch ("find me by ear")

**State (2026-11-17):** feature-complete and pushed to `origin/audio`. Tests pass: 14 Rails, 19 solver. It has not been tested with a real microphone yet.

## What it is
The visitor grants only the microphone. A Python solver (`sidecar/`) matches aircraft Doppler curves in their audio against live ADS-B data around their IP location, then refines its guess every 5 s. Afterwards the visitor may drop a pin. The `results` table stores two distances only: our guess to the pin, and the IP location to the pin. There is no login, and audio is held in memory only. `main` still has the old portrait app. See `README.md` for how it works and how to run it.

## Key facts learned
- **One pass is always ambiguous.** Any aircraft within about 10% of the real one's speed fits some spot on the ground, and each spot has a mirror image across the flight path. A confident fix needs two events whose candidate spots agree (`session.py: _find_events`, `_decide`).
- **Speed separation comes from the ridge contrast in `spectro.whiten`.** Planes more than about 25% off in speed drop out; within about 10% they stay rivals.
- **Expect mostly IP-only results.** Close prop passes are rare in a few minutes of listening.

## Next steps
1. Test with a real mic in Chrome, Safari and Firefox. Check that `track.getSettings()` shows noise suppression actually off. Try it near a window under general-aviation traffic.
2. Deploy on Coolify with `docker-compose.yml`:
   - set `RAILS_MASTER_KEY` and `SOLVER_KEY`
   - the IP database (DB-IP City Lite) downloads itself on boot; check the log for `geo: fetched`
3. Measure solver tick time on the server hardware. On an M-series Mac a tick with 5 aircraft takes about 2.4 s. The budget is under 5 s per chunk.
4. Possible improvements:
   - ENF (mains-frequency) matching against live grid feeds
   - backfilling ADS-B history so passes early in a session can be scored
   - a geoid correction (the DEM uses EGM2008 heights; aircraft altitude is GNSS ellipsoid height)

## Local dev
```sh
cd sidecar && SOLVER_DEV=1 SOLVER_KEY=dev DEM_CACHE=./dem-cache .venv/bin/uvicorn app.server:app --port 8000
SOLVER_KEY=dev ME_DEV_PRIOR="41.8268,-71.4025,30" bin/rails server
```
`SOLVER_DEV=1` enables the "play a test flight" button, which plays a synthetic plane with a known location.
