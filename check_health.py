#!/usr/bin/env python
"""Probe every upstream data source and write web/public/health.json.

Each check does a real request and validates the SHAPE of the response, not just
the status code. A 200 that returns an HTML error page or an empty series is a
failure — that distinction is the whole point of a health check.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "web" / "public" / "health.json"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}


def _check(name: str, purpose: str, auth: str, fn) -> dict:
    started = time.perf_counter()
    entry = {"name": name, "purpose": purpose, "auth": auth}
    try:
        detail = fn()
        entry.update(status="ok", detail=detail)
    except Exception as exc:
        entry.update(status="down", detail=f"{type(exc).__name__}: {exc}"[:200])
    entry["latency_ms"] = round((time.perf_counter() - started) * 1000)
    return entry


def amfi() -> str:
    r = requests.get("https://portal.amfiindia.com/spages/NAVAll.txt", headers=UA, timeout=60)
    r.raise_for_status()
    lines = [l for l in r.text.splitlines() if ";" in l]
    if len(lines) < 1000:
        raise ValueError(f"only {len(lines)} scheme rows — expected thousands")
    return f"{len(lines):,} scheme rows"


def mfapi() -> str:
    r = requests.get("https://api.mfapi.in/mf/122639", headers=UA, timeout=45)
    r.raise_for_status()
    j = r.json()
    if not j.get("data"):
        raise ValueError("no NAV history in payload")
    return f"{len(j['data']):,} NAVs, latest {j['data'][0]['date']}"


def yahoo_quote() -> str:
    r = requests.get(
        "https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS",
        params={"range": "5d", "interval": "1d"},
        headers=UA,
        timeout=45,
    )
    r.raise_for_status()
    meta = r.json()["chart"]["result"][0]["meta"]
    if not meta.get("regularMarketPrice"):
        raise ValueError("no price in payload")
    return f"{meta['symbol']} @ {meta['regularMarketPrice']} {meta.get('currency', '')}"


def yahoo_fundamentals() -> str:
    import yfinance as yf

    bs = yf.Ticker("RELIANCE.NS").balance_sheet
    if bs is None or bs.empty:
        raise ValueError("empty balance sheet")
    if "Stockholders Equity" not in bs.index:
        raise ValueError("missing Stockholders Equity row")
    return f"{bs.shape[1]} annual periods, {bs.shape[0]} line items"


def nse_constituents() -> str:
    import io

    import pandas as pd

    r = requests.get(
        "https://archives.nseindia.com/content/indices/ind_nifty200list.csv", headers=UA, timeout=45
    )
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    if "Symbol" not in df.columns or len(df) < 100:
        raise ValueError(f"unexpected shape {df.shape}")
    return f"{len(df)} constituents"


CHECKS = [
    ("AMFI NAVAll", "Full MF universe + daily NAV", "none", amfi),
    ("mfapi.in", "MF historical NAV series", "none", mfapi),
    ("Yahoo chart", "Equity & index OHLCV, quotes", "none", yahoo_quote),
    ("Yahoo statements", "Fundamentals (ROE, margins, growth)", "none", yahoo_fundamentals),
    ("NSE archives", "Official index constituent lists", "none", nse_constituents),
]


def main() -> int:
    results = [_check(n, p, a, f) for n, p, a, f in CHECKS]
    up = sum(r["status"] == "ok" for r in results)

    payload = {
        "checked_at": datetime.now().isoformat(timespec="seconds"),
        "up": up,
        "total": len(results),
        "sources": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1))

    for r in results:
        mark = "OK  " if r["status"] == "ok" else "DOWN"
        print(f"  [{mark}] {r['name']:20s} {r['latency_ms']:>6}ms  {r['detail']}")
    print(f"\n{up}/{len(results)} sources healthy -> {OUT}")
    return 0 if up == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
