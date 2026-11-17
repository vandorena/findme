import time

import numpy as np
import pytest

from app import mains, synth
from app.adsb import TilePoller, classify, parse_aircraft
from app.dem import Dem
from app.doppler import MIC_AGL
from app.geo import haversine_m
from app.session import Session
from app.spectro import FS

LAT, LON = 41.8268, -71.4025
T0 = 1_800_000_000.0
LISTENER = (2300.0, -1700.0)


def new_session(cap_s=300.0, country="US"):
    s = Session("t", LAT, LON, 25.0, cap_s, country, TilePoller(offline=True), Dem(None, offline=True))
    for _ in range(100):
        if s.lattice is not None:
            break
        time.sleep(0.05)
    return s


def fly(s, hex_code, heading, t_cpa, offset_m, alt_m=600.0, speed=75.0, kind="prop"):
    args = (s.frame, LISTENER, heading, speed, alt_m, t_cpa, offset_m)
    synth.add_to_tile(s.tile, hex_code, synth.straight_flight(*args), callsign=hex_code.upper(), kind=kind)
    return synth.track_from_samples(synth.straight_flight(*args, jitter_m=0), s.frame)


def feed(s, audio, ticks=True):
    for i in range(0, len(audio), 5 * FS):
        s.append(audio[i:i + 5 * FS], T0 + i / FS)
        if ticks:
            s.tick()
    if not ticks:
        s.tick()
    return s.snapshot()


def listener_point():
    return np.array([LISTENER[0], LISTENER[1], MIC_AGL])


def error_m(s, snap):
    lat, lon = s.frame.to_latlon(*LISTENER)
    return haversine_m(snap["guess"]["lat"], snap["guess"]["lon"], float(lat), float(lon))


def test_one_pass_is_heard_but_leaves_a_mirror():
    s = new_session()
    track = fly(s, "a1", heading=70, t_cpa=T0 + 70, offset_m=1200)
    snap = feed(s, synth.render(track, listener_point(), T0, 150, snr_db=0, mains_hz=60))

    assert snap["tier"] == "doppler"
    assert [a["hex"] for a in snap["heard"]] == ["a1"]
    assert snap["ambiguous"]
    assert not snap["done"]
    # The guess is the listener or its mirror image across the flight line (2 x 1200 m away).
    assert min(error_m(s, snap), abs(error_m(s, snap) - 2400)) < 400


def test_two_passes_on_different_lines_find_the_listener():
    s = new_session()
    a = fly(s, "a1", heading=70, t_cpa=T0 + 60, offset_m=1200)
    b = fly(s, "b2", heading=160, t_cpa=T0 + 160, offset_m=-900, speed=60, alt_m=450)
    audio = (synth.render(a, listener_point(), T0, 230, snr_db=0, noise_seed=1)
             + synth.render(b, listener_point(), T0, 230, f0=140, snr_db=0, noise_seed=2))
    snap = feed(s, audio)

    assert {h["hex"] for h in snap["heard"]} == {"a1", "b2"}
    assert not snap["ambiguous"]
    assert snap["done"]
    assert error_m(s, snap) < 300
    assert snap["curves"] and snap["curves"][0]["points"]


def test_aircraft_overhead_but_silent_audio_is_not_heard():
    s = new_session()
    fly(s, "a1", heading=70, t_cpa=T0 + 70, offset_m=1200)
    rng = np.random.default_rng(3)
    room = synth.highpass(synth.pink(150 * FS, rng), 120) * 0.05
    snap = feed(s, room.astype(np.float32))

    assert snap["heard"] == []
    assert snap["tier"] == "ip"
    assert snap["guess"]["lat"] == LAT
    assert len(snap["aircraft"]) == 1


def test_a_steady_tone_is_not_mistaken_for_a_flyover():
    s = new_session()
    fly(s, "a1", heading=70, t_cpa=T0 + 70, offset_m=1200)
    t = np.arange(150 * FS) / FS
    fridge = 0.1 * np.sin(2 * np.pi * 117 * t) + 0.01 * np.random.default_rng(4).normal(size=len(t))
    snap = feed(s, fridge.astype(np.float32))

    assert snap["heard"] == []


def test_rising_sweep_fails_the_reverse_control():
    s = new_session()
    track = fly(s, "a1", heading=70, t_cpa=T0 + 70, offset_m=1200)
    audio = synth.render(track, listener_point(), T0, 150, snr_db=0)
    snap = feed(s, audio[::-1].copy())

    assert snap["heard"] == []


def test_cap_ends_the_hunt_without_a_plane():
    s = new_session(cap_s=30)
    rng = np.random.default_rng(5)
    snap = feed(s, (synth.pink(35 * FS, rng) * 0.01).astype(np.float32))
    assert snap["done"]
    assert snap["tier"] == "ip"


@pytest.mark.parametrize("hz", [50, 60])
def test_mains_hum_names_the_grid(hz):
    rng = np.random.default_rng(6)
    t = np.arange(25 * FS) / FS
    hum = sum(0.02 / h * np.sin(2 * np.pi * hz * h * t) for h in range(2, 5))  # no fundamental: laptop mic
    noise = synth.highpass(synth.pink(len(t), rng), 120)
    x = hum + noise / np.std(noise) * 0.02
    found = mains.detect(x.astype(np.float32))
    assert found and found["hz"] == hz
    assert abs(found["fundamental"] - hz) < 0.2


def test_no_hum_no_answer():
    rng = np.random.default_rng(7)
    assert mains.detect(synth.pink(25 * FS, rng).astype(np.float32)) is None


def test_mains_mismatch_is_reported():
    s = new_session(country="DE")
    t = np.arange(30 * FS) / FS
    rng = np.random.default_rng(8)
    x = sum(0.02 / h * np.sin(2 * np.pi * 60 * h * t) for h in range(1, 5)) + synth.pink(len(t), rng) * 0.002
    snap = feed(s, x.astype(np.float32))
    assert snap["tier"] == "mains"
    assert snap["mains"]["hz"] == 60 and snap["mains_expected"] == 50
    assert "60 Hz" in snap["status"]


def test_a_tick_stays_within_budget():
    s = new_session()
    a = fly(s, "a1", heading=70, t_cpa=T0 + 60, offset_m=1200)
    for i, h in enumerate((10, 100, 200, 300)):
        fly(s, f"x{i}", heading=h, t_cpa=T0 + 40 + 30 * i, offset_m=3000 + 500 * i)
    audio = synth.render(a, listener_point(), T0, 120, snr_db=0)
    for i in range(0, len(audio) - 5 * FS, 5 * FS):
        s.append(audio[i:i + 5 * FS], T0 + i / FS)
    started = time.time()
    s.append(audio[-5 * FS:], T0 + (len(audio) - 5 * FS) / FS)
    s.tick()
    assert time.time() - started < 5.0, s.snapshot()["tick_ms"]


def test_adsb_records_are_parsed_and_classified():
    ac = {"hex": "A1B2C3", "flight": "N123AB  ", "t": "PC12", "category": "A1", "alt_baro": 3000,
          "alt_geom": 3100, "gs": 200, "track": 90, "lat": 41.9, "lon": -71.5, "seen_pos": 1.5}
    ident, sample = parse_aircraft(ac, 1000.0)
    assert ident == {"hex": "a1b2c3", "callsign": "N123AB", "type_code": "PC12", "kind": "prop"}
    assert sample.t == 998.5 and abs(sample.alt_m - 3100 * 0.3048) < 1e-6
    assert abs(sample.vx - 200 * 0.514444) < 1e-3 and abs(sample.vy) < 1e-6
    assert parse_aircraft({**ac, "alt_baro": "ground"}, 1000.0) is None
    assert parse_aircraft({**ac, "gs": 10}, 1000.0) is None
    assert classify("A3", "B738") == "jet" and classify("A7", None) == "heli" and classify(None, "R44") == "heli"
