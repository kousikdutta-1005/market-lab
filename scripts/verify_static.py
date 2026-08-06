#!/usr/bin/env python3
"""Pre-deploy sanity check for the static bundle.

Publishing a corrupt bundle is worse than publishing nothing: the previous, working site
gets replaced by one that fails in every visitor's browser, and with a static deploy there
is no server-side error to alert on. This runs before the upload step and fails the build
loudly instead.

The checks are deliberately about things that have actually broken JSON payloads before —
NaN tokens, empty files, offsets pointing past the end of the calendar — rather than a
schema restatement that just drifts from reality.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"

# A run that produced far fewer names than this means an upstream silently returned
# almost nothing, which must not reach users as a "market with 12 stocks".
MIN_STOCKS = 800
MIN_CHARTS = 500

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"FAIL  {msg}")


def ok(msg: str) -> None:
    print(f"ok    {msg}")


def load(path: Path):
    """Parse strictly: NaN/Infinity are not valid JSON and would break JSON.parse."""
    text = path.read_text()
    return json.loads(text, parse_constant=lambda c: (_ for _ in ()).throw(
        ValueError(f"non-JSON constant {c!r} in {path.name}")
    ))


def main() -> int:
    if not DATA.exists():
        fail(f"missing static data directory: {DATA}")
        return 1

    # --- board -------------------------------------------------------------------
    try:
        screen = load(DATA / "screen.json")
        cols = screen["stocks"]["columns"]
        rows = screen["stocks"]["rows"]
        if screen.get("format") != "columnar-v1":
            fail(f"unexpected screen format: {screen.get('format')!r}")
        if len(rows) < MIN_STOCKS:
            fail(f"only {len(rows)} stocks (expected >= {MIN_STOCKS})")
        else:
            ok(f"screen.json: {len(rows)} stocks x {len(cols)} columns")
        if "symbol" not in cols:
            fail("screen.json has no symbol column")
        bad = [r for r in rows if len(r) != len(cols)]
        if bad:
            fail(f"{len(bad)} rows do not match the column count")
        if not screen.get("meta", {}).get("last_trading_session"):
            fail("screen.json meta is missing last_trading_session")
    except Exception as e:
        fail(f"screen.json unreadable: {type(e).__name__}: {e}")
        return 1

    # --- calendar ----------------------------------------------------------------
    try:
        cal = load(DATA / "calendar.json")
        dates = cal["dates"]
        if not dates:
            fail("calendar.json has no dates")
        if len(cal.get("market_return_pct", [])) != len(dates):
            fail("calendar market series length does not match the date axis")
        ok(f"calendar.json: {len(dates)} sessions ({dates[0]} -> {dates[-1]})")
    except Exception as e:
        fail(f"calendar.json unreadable: {type(e).__name__}: {e}")
        return 1

    # --- charts ------------------------------------------------------------------
    charts = sorted((DATA / "charts").glob("*.json"))
    if len(charts) < MIN_CHARTS:
        fail(f"only {len(charts)} chart files (expected >= {MIN_CHARTS})")
    else:
        ok(f"charts: {len(charts)} files")

    # Sampling rather than checking all 1,600: enough to catch a systemic export bug
    # without adding a minute to every build.
    for p in random.sample(charts, min(25, len(charts))):
        try:
            c = load(p)
            n = len(c["close"])
            if n == 0:
                fail(f"{p.name}: empty series")
            if c["off"] + n > len(dates):
                fail(f"{p.name}: offset {c['off']} + {n} runs past the {len(dates)}-day calendar")
            for series in ("ma50", "ma200"):
                if series in c and len(c[series]) != n:
                    fail(f"{p.name}: {series} length {len(c[series])} != close length {n}")
        except Exception as e:
            fail(f"{p.name} unreadable: {type(e).__name__}: {e}")
    ok("chart sample parsed and aligned to the calendar")

    # --- sources -----------------------------------------------------------------
    try:
        src = load(DATA / "sources.json")
        n_ok = sum(1 for s in src.get("sources", []) if s.get("ok"))
        total = len(src.get("sources", []))
        if total == 0:
            print("warn  sources.json is empty (probes did not run this build)")
        else:
            ok(f"sources.json: {n_ok}/{total} reachable at build time")
    except Exception as e:
        fail(f"sources.json unreadable: {type(e).__name__}: {e}")

    # --- provenance ---------------------------------------------------------------
    try:
        man = load(DATA / "manifest.json")
        files = man["files"]
        checked = 0
        for rel in random.sample(list(files), min(15, len(files))):
            p = DATA / rel
            if not p.exists():
                fail(f"manifest lists a missing file: {rel}")
                continue
            h = hashlib.sha256(p.read_bytes()).hexdigest()
            if h != files[rel]["sha256"]:
                fail(f"hash mismatch for {rel}")
            checked += 1
        ok(f"manifest.json: {len(files)} files, {checked} hashes verified")
    except Exception as e:
        fail(f"manifest.json unreadable: {type(e).__name__}: {e}")

    if failures:
        print(f"\n{len(failures)} check(s) failed — refusing to deploy this bundle.")
        return 1
    print("\nBundle looks deployable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
