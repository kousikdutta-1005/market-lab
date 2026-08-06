"""Connectivity probes for every upstream this tool depends on.

Lives here rather than in server.py because two very different callers need it: the local
backend answers /api/sources live, and the static build records a snapshot so the public
site can show source health without a server — and without pointing a million browsers at
NSE's endpoints, which would be both useless (CORS) and abusive.
"""

from __future__ import annotations

import datetime as dt
import time

from . import bhavcopy as bc


def _probe(out: list, name: str, fn, note: str = "") -> None:
    t0 = time.time()
    try:
        ok, detail = fn()
    except Exception as e:
        # A probe is diagnostics. It must never raise into the caller, or one dead
        # upstream would take down the whole refresh it was meant to describe.
        ok, detail = False, f"{type(e).__name__}: {e}"
    out.append(
        {
            "name": name,
            "ok": bool(ok),
            "detail": str(detail),
            "ms": round((time.time() - t0) * 1000),
            "note": note,
        }
    )


def probe_all(timeout: int = 12) -> list[dict]:
    """Check every source. Returns one row per source, always in the same order."""
    import requests

    out: list[dict] = []

    def nse_bhavcopy():
        d = bc.latest_available(max_back=6)
        return (d is not None), (f"latest session {d}" if d else "no recent file")

    def nse_indices():
        from . import universe as un

        n = len(un.index_members("nifty50"))
        return n >= 45, f"{n} Nifty 50 constituents"

    def nse_equity_list():
        from . import universe as un

        n = len(un.all_listed())
        return n > 1500, f"{n} listed securities"

    def bse_announcements():
        from . import news

        df = news._bse_day(dt.date.today(), max_pages=1)
        return True, f"endpoint reachable ({len(df)} rows on first page)"

    def nse_large_deals():
        from . import deals

        raw, meta = deals.fetch(timeout=timeout)
        return meta["deal_status"] == "ok", f"{len(raw)} bulk/block/short deal rows"

    def nse_delivery():
        from . import delivery

        d = bc.latest_available(max_back=6)
        if d is None:
            return False, "no recent trading session"
        # NSE publishes sec_bhavdata_full later than the price bhavcopy, so between the
        # two there is a window where today's file legitimately does not exist yet. That
        # is "not published", not "broken", and reporting it as a failure made a healthy
        # feed look dead every evening. Walk back to the newest day that does exist.
        df = delivery.day(d, timeout=timeout)
        if df is not None and not df.empty:
            return True, f"{len(df)} delivery rows for {d}"
        for back in range(1, 5):
            prev = d - dt.timedelta(days=back)
            older = delivery.day(prev, timeout=timeout)
            if older is not None and not older.empty:
                return True, f"{len(older)} rows for {prev} (awaiting {d})"
        return False, f"no delivery file within 4 sessions of {d}"

    def nse_fo_ban():
        from . import risk

        symbols, meta = risk.fetch_fo_ban(timeout=timeout)
        return meta["risk_status"] in {"ok", "partial"}, f"{len(symbols)} symbols in F&O ban"

    def yahoo():
        r = requests.get(
            "https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS",
            params={"range": "1d", "interval": "1d"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=20,
        )
        if r.status_code == 429:
            return False, "rate limited (HTTP 429)"
        return r.status_code == 200, f"HTTP {r.status_code}"

    _probe(out, "NSE bhavcopy", nse_bhavcopy, "primary price source, EOD")
    _probe(out, "NSE index lists", nse_indices, "universe + size buckets")
    _probe(out, "NSE equity list", nse_equity_list, "tradeable series filter")
    _probe(out, "BSE announcements", bse_announcements, "same-day official corporate events")
    _probe(out, "NSE large deals", nse_large_deals, "bulk, block and short-deal snapshot")
    _probe(out, "NSE delivery", nse_delivery, "delivery percentage and participation")
    _probe(out, "NSE F&O ban", nse_fo_ban, "surveillance/risk context")
    _probe(out, "Yahoo Finance", yahoo, "fundamentals only; optional")
    return out
