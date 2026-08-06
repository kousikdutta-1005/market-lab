"""Static site data export: turn a pipeline run into files a CDN can serve forever.

WHY THIS EXISTS
A FastAPI backend is fine for one person on localhost. It is the wrong shape for a free
public tool: every visitor costs CPU, the pipeline cannot run per-request anyway (NSE
publishes once a day), and any always-on host costs money that grows with traffic.

So production ships **no backend at all**. This module writes the exact bytes a static
CDN needs, and the frontend reads them directly. Serving cost then becomes hosting cost,
which on Cloudflare Pages is zero at any traffic level.

WHAT IT OPTIMISES FOR
1. Bytes on the wire. A row-of-objects JSON repeats every key ~1,600 times. Columnar
   layout stores each key once. Floats are rounded to the precision the UI actually
   renders — trailing garbage like 12.340000000000002 is pure waste.
2. Requests that stay small. Chart history is per-symbol, so a visitor downloads the one
   stock they clicked instead of the whole market's price history.
3. Shared axes. Every NSE symbol trades on the same calendar, so dates are stored once
   globally and each symbol stores an offset into that calendar. Same for the
   equal-weighted market line, which is identical on every chart.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import shutil
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "web" / "public" / "data"

# Two years covers every range the UI offers (3m/6m/1y/2y). Storing more would grow the
# deploy for data no screen can currently show.
CHART_SESSIONS = 504

FORMAT_VERSION = "columnar-v1"


def _round(v, places: int):
    """Round for transport, preserving None and dropping non-finite values.

    NaN and Infinity are not legal JSON. json.dumps emits them anyway as bare NaN /
    Infinity tokens, which JSON.parse then rejects — a whole-page failure caused by one
    bad cell. Converting them to null here keeps the payload parseable.
    """
    if v is None:
        return None
    if isinstance(v, (int,)) and not isinstance(v, bool):
        return v
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    if not math.isfinite(f):
        return None
    r = round(f, places)
    # Integral values serialise shorter without the trailing ".0".
    return int(r) if r == int(r) and abs(r) < 1e15 else r


def _columnarise(rows: list[dict]) -> dict:
    """Rows of objects -> {columns, rows}, preserving column order across all rows."""
    if not rows:
        return {"columns": [], "rows": []}
    columns: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for k in row:
            if k not in seen:
                seen.add(k)
                columns.append(k)
    packed = [[row.get(c) for c in columns] for row in rows]
    return {"columns": columns, "rows": packed}


def _round_payload_rows(rows: list[dict]) -> list[dict]:
    """Trim float precision to what the UI renders.

    Scores show as integers, ratios to 2dp, and rates like ROE are fractions shown to one
    decimal as a percent, so 4dp is already more than the screen can display.
    """
    score_like = {
        "composite", "composite_raw", "investable_score", "short_fit", "medium_fit",
        "long_fit", "liquidity_score", "news_event_score", "deal_activity_score",
        "delivery_accumulation_score", "risk_score", "opportunity_score",
        "quality", "growth", "valuation", "trend", "momentum",
    }
    ratio_like = {
        "pe", "pb", "ev_ebitda", "debt_to_equity", "delivery_pct_latest",
        "delivery_pct_median_20d", "delivery_spike", "above_50dma", "above_200dma",
        "dist_52w_high", "mom_6m_risk_adj", "mom_12m_risk_adj", "coverage",
        "sast_latest_stake",
    }
    rate_like = {
        "roe", "roa", "operating_margin", "net_margin", "revenue_cagr", "earnings_cagr",
        "dividend_yield", "ret_6m", "ret_12m", "ann_vol", "rs_vs_nifty",
    }
    out = []
    for row in rows:
        r = dict(row)
        for k, v in r.items():
            if v is None or isinstance(v, (str, bool, list, dict)):
                continue
            if k in score_like:
                r[k] = _round(v, 1)
            elif k in ratio_like:
                r[k] = _round(v, 2)
            elif k in rate_like:
                r[k] = _round(v, 4)
            elif k in {"price"}:
                r[k] = _round(v, 2)
            else:
                # Currency and count columns: whole units are plenty.
                r[k] = _round(v, 0)
        out.append(r)
    return out


def _scrub(obj):
    """Recursively replace NaN/Infinity with null.

    Meta now carries nested structures (investor holdings), and a single NaN anywhere in
    them makes the whole document unserialisable with allow_nan=False — which failed the
    entire static build rather than one field.
    """
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_scrub(v) for v in obj]
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    return obj


def write_screen(payload: dict, out: Path) -> Path:
    """Write the columnar board file the frontend loads on first paint."""
    stocks = _round_payload_rows(payload.get("stocks", []))
    excluded = payload.get("excluded", [])
    meta = _scrub({k: v for k, v in payload.items() if k not in {"stocks", "excluded"}})

    doc = {
        "format": FORMAT_VERSION,
        "meta": meta,
        "stocks": _columnarise(stocks),
        "excluded": _columnarise(excluded),
    }
    out.mkdir(parents=True, exist_ok=True)
    p = out / "screen.json"
    p.write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False))
    return p


def write_charts(mats: dict, symbols, out: Path, sessions: int = CHART_SESSIONS) -> dict:
    """Write one compact history file per symbol plus the shared calendar.

    Each symbol file stores an `off` (offset into the global calendar) instead of its own
    date list, because the dates are identical for every symbol that traded that day.
    """
    close = mats.get("close")
    if close is None or close.empty:
        return {"charts": 0, "sessions": 0}

    close = close.tail(sessions)
    turnover = mats.get("turnover")
    volume = mats.get("volume")
    if turnover is not None:
        turnover = turnover.reindex(close.index)
    if volume is not None:
        volume = volume.reindex(close.index)

    dates = [str(pd.Timestamp(d).date()) for d in close.index]

    # Equal-weighted market return, identical on every chart, so it ships once.
    norm = close.div(close.iloc[0])
    norm = norm.replace([float("inf"), float("-inf")], pd.NA)
    market = ((norm.mean(axis=1) - 1) * 100).tolist()

    charts_dir = out / "charts"
    if charts_dir.exists():
        # Stale symbols (delisted, renamed) would otherwise linger in the deploy forever.
        shutil.rmtree(charts_dir)
    charts_dir.mkdir(parents=True, exist_ok=True)

    (out / "calendar.json").write_text(
        json.dumps(
            {"dates": dates, "market_return_pct": [_round(v, 3) for v in market]},
            separators=(",", ":"),
            allow_nan=False,
        )
    )

    wanted = [s for s in symbols if s in close.columns]
    written = 0
    for sym in wanted:
        px = pd.to_numeric(close[sym], errors="coerce")
        valid = px.notna()
        if not valid.any():
            continue
        first = int(valid.argmax())
        px = px.iloc[first:]

        ma50 = px.rolling(50, min_periods=50).mean()
        ma200 = px.rolling(200, min_periods=200).mean()

        doc = {
            "sym": sym,
            "off": first,
            "close": [_round(v, 2) for v in px.tolist()],
            "ma50": [_round(v, 2) for v in ma50.tolist()],
            "ma200": [_round(v, 2) for v in ma200.tolist()],
        }
        if turnover is not None and sym in turnover.columns:
            doc["turnover"] = [_round(v, 0) for v in turnover[sym].iloc[first:].tolist()]
        if volume is not None and sym in volume.columns:
            doc["volume"] = [_round(v, 0) for v in volume[sym].iloc[first:].tolist()]

        # Symbols legitimately contain "&" and "-", which are safe in a filename, but a
        # "/" would silently create a directory. Refuse rather than write to the wrong path.
        if "/" in sym or sym in {".", ".."}:
            continue
        (charts_dir / f"{sym}.json").write_text(
            json.dumps(doc, separators=(",", ":"), allow_nan=False)
        )
        written += 1

    return {"charts": written, "sessions": len(dates)}


def write_sources(sources: list[dict] | None, out: Path, checked_at: str | None = None) -> Path:
    """Snapshot source health so the static site can show it without probing live."""
    out.mkdir(parents=True, exist_ok=True)
    p = out / "sources.json"
    p.write_text(
        json.dumps(
            {"checked_at": checked_at, "sources": sources or []},
            separators=(",", ":"),
            allow_nan=False,
        )
    )
    return p


def _git_commit() -> str | None:
    """Best-effort commit id, so a deploy can be traced back to exact source."""
    import subprocess

    try:
        r = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return r.stdout.strip() or None if r.returncode == 0 else None
    except Exception:
        return None


def write_manifest(out: Path, extra: dict | None = None) -> Path:
    """Hash every published file so the deploy is independently verifiable.

    This is the transparency counterpart to open source: anyone can confirm the bytes a
    visitor received are exactly what the published pipeline produced from a named
    commit, rather than something quietly hand-edited. It also gives an authentic build a
    checkable identity that a scraped copy cannot claim.
    """
    import hashlib

    files = {}
    for p in sorted(out.rglob("*")):
        if not p.is_file() or p.name == "manifest.json":
            continue
        h = hashlib.sha256()
        with p.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        files[str(p.relative_to(out))] = {"sha256": h.hexdigest(), "bytes": p.stat().st_size}

    doc = {
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "git_commit": _git_commit(),
        "format": FORMAT_VERSION,
        "file_count": len(files),
        "total_bytes": sum(f["bytes"] for f in files.values()),
        **(extra or {}),
        "files": files,
    }
    p = out / "manifest.json"
    p.write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False))
    return p


def build(payload: dict, mats: dict, out: Path | None = None, sources: list[dict] | None = None) -> dict:
    """Write the complete static bundle. Returns a small summary for logging."""
    out = Path(out or DEFAULT_OUT)
    screen_path = write_screen(payload, out)
    symbols = [r["symbol"] for r in payload.get("stocks", []) if r.get("symbol")]
    chart_meta = write_charts(mats, symbols, out)
    write_sources(sources, out, checked_at=payload.get("generated_at"))
    write_manifest(
        out,
        extra={
            "last_trading_session": payload.get("last_trading_session"),
            "generated_at": payload.get("generated_at"),
            "scored": payload.get("scored"),
        },
    )
    return {
        "screen_bytes": screen_path.stat().st_size,
        "static_out": str(out),
        **chart_meta,
    }
