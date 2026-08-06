"""The refresh pipeline: raw exchange data in, scored table out.

Split into stages so the web backend can report progress and so a cheap refresh
(today's prices) is distinguishable from an expensive one (re-pulling fundamentals).

HOW OFTEN EACH LAYER ACTUALLY CHANGES — this drives the whole refresh design:
    prices        once per trading day, when NSE publishes the bhavcopy (~18:00 IST)
    liquidity     recomputed from prices, so also daily
    fundamentals  quarterly, when companies file results
    scores        only when one of the above moves

Nothing here changes every few seconds. A UI that polls faster than the data updates
is showing motion, not information, so the interface reports the age of each layer
rather than implying everything is live.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from . import bhavcopy as bc
from . import news
from . import bulk, liquidity as lq, rating, universe as un

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "web" / "public"

BENCH = "NIFTY 50"
HISTORY_DAYS = 730

HORIZON_WEIGHTS = {
    "short": {
        "label": "1-3 months",
        "weights": {"momentum": 0.35, "trend": 0.25, "liquidity_score": 0.20, "news_event_score": 0.15, "valuation": 0.05},
    },
    "medium": {
        "label": "6-12 months",
        "weights": {
            "quality": 0.20,
            "growth": 0.20,
            "valuation": 0.15,
            "trend": 0.15,
            "momentum": 0.20,
            "liquidity_score": 0.05,
            "news_event_score": 0.05,
        },
    },
    "long": {
        "label": "3-5 years",
        "weights": {
            "quality": 0.30,
            "growth": 0.25,
            "valuation": 0.20,
            "liquidity_score": 0.10,
            "trend": 0.05,
            "momentum": 0.05,
            "news_event_score": 0.05,
        },
    },
}


def _clean(v):
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 4)
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, (pd.Timestamp, dt.date)):
        return str(v)
    return v


def refresh_prices(progress=None, on_log=print) -> dict[str, pd.DataFrame]:
    """Fetch any bhavcopy days we don't already have, then rebuild the matrices."""
    end = bc.latest_available() or dt.date.today()
    start = end - dt.timedelta(days=HISTORY_DAYS)
    on_log(f"prices: {start} .. {end}")
    long = bc.fetch_range(start, end, workers=6, progress=progress, on_log=on_log)
    if long.empty:
        raise RuntimeError("no bhavcopy data returned")
    mats = bc.matrices(long)
    bc.save(mats, prefix="nse")
    return mats


def build_liquidity(mats: dict, u: pd.DataFrame, on_log=print) -> pd.DataFrame:
    syms = [s for s in mats["close"].columns if s in u.index]
    stats = pd.DataFrame(
        {
            s: lq.measure(
                mats["close"][s],
                mats["volume"][s],
                turnover=mats.get("turnover", {}).get(s) if "turnover" in mats else None,
                trades=mats.get("trades", {}).get(s) if "trades" in mats else None,
            )
            for s in syms
        }
    ).T
    sc = lq.screen(stats, u["bucket"])
    sc["bucket"] = u["bucket"].reindex(sc.index)
    sc.to_pickle(DATA / "liquidity.pkl")
    on_log(f"liquidity: {int(sc.tradeable.sum())} tradeable, {int(sc.scoreable.sum())} scoreable")
    return sc


def _benchmark(mats: dict, u: pd.DataFrame) -> pd.Series:
    """Equal-weight Nifty 50 proxy, built from the same bhavcopy as everything else.

    Using an internally consistent benchmark avoids comparing stock returns measured on
    exchange closes against an index measured from a different vendor's series.
    """
    try:
        members = [s for s in un.index_members("nifty50") if s in mats["close"].columns]
    except Exception:
        members = []
    if not members:
        return mats["close"].mean(axis=1)
    px = mats["close"][members].dropna(how="all")
    norm = px.div(px.ffill().bfill().iloc[0])
    return norm.mean(axis=1)


def live_quote_status() -> dict:
    """Probe free live quote endpoints without making them critical to refresh.

    If one of these becomes usable, this is where a true intraday overlay can be wired.
    Today they are not usable for whole-market stock quotes from this environment:
    Yahoo's batch quote endpoint returns 401 and NSE's per-symbol quote endpoint returns
    403. NSE allIndices is reachable, but it is index-level, not stock-level.
    """
    out = {
        "live_quote_status": "unavailable",
        "live_quote_source": None,
        "live_quote_detail": "No whole-market free live stock quote source reachable",
    }
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*"}
    try:
        r = requests.get(
            "https://query1.finance.yahoo.com/v7/finance/quote",
            params={"symbols": "RELIANCE.NS,TCS.NS"},
            headers=headers,
            timeout=10,
        )
        if r.status_code == 200:
            return {
                "live_quote_status": "available",
                "live_quote_source": "Yahoo Finance quote",
                "live_quote_detail": "Yahoo batch quote endpoint reachable",
            }
        yahoo = f"Yahoo quote HTTP {r.status_code}"
    except Exception as e:
        yahoo = f"Yahoo quote {type(e).__name__}"

    try:
        r = requests.get(
            "https://www.nseindia.com/api/quote-equity",
            params={"symbol": "RELIANCE"},
            headers={**headers, "Referer": "https://www.nseindia.com/market-data/live-equity-market"},
            timeout=10,
        )
        if r.status_code == 200:
            return {
                "live_quote_status": "available",
                "live_quote_source": "NSE quote-equity",
                "live_quote_detail": "NSE per-symbol quote endpoint reachable",
            }
        nse = f"NSE quote HTTP {r.status_code}"
    except Exception as e:
        nse = f"NSE quote {type(e).__name__}"

    out["live_quote_detail"] = f"{yahoo}; {nse}. Using NSE EOD bhavcopy for stock prices."
    return out


def build_scores(mats: dict, u: pd.DataFrame, liq: pd.DataFrame, on_log=print) -> pd.DataFrame:
    close = mats["close"]
    scoreable = liq.index[liq["scoreable"]]
    px = close[[s for s in scoreable if s in close.columns]].ffill(limit=5)

    tech = rating.technicals(px, _benchmark(mats, u))
    on_log(f"technicals: {len(tech)} stocks")

    combined = tech.join(u[["company_name", "industry", "bucket"]], how="left")
    combined = combined.rename(columns={"company_name": "name", "industry": "sector"})

    # Whole-market file if it exists, else the older Nifty 200 one. Both are keyed by
    # symbol; the market file is a superset, so preferring it is always correct.
    fpath = next(
        (DATA / n for n in ("market_fundamentals.pkl", "n200_fundamentals.pkl") if (DATA / n).exists()),
        None,
    )
    if fpath is not None:
        f = pd.read_pickle(fpath)
        f.index = [i[:-3] if isinstance(i, str) and i.endswith(".NS") else i for i in f.index]
        keep = [c for c in f.columns if c not in combined.columns]
        combined = combined.join(f[keep], how="left")
        have = combined["roe"].notna().sum() if "roe" in combined else 0
        on_log(f"fundamentals: {have}/{len(combined)} stocks have ROE")

    combined = combined.join(
        liq[["turnover_median", "trades_median", "sessions", "bucket"]].rename(
            columns={"bucket": "_b"}
        ),
        how="left",
    ).drop(columns=["_b"], errors="ignore")

    scored = rating.score(combined, groups=combined["bucket"])
    on_log(f"scored: {int(scored['composite'].notna().sum())} stocks")
    return combined.join(scored, how="right")


def _rank_within_bucket(s: pd.Series, buckets: pd.Series, higher: bool = True) -> pd.Series:
    v = pd.to_numeric(s, errors="coerce")
    if not higher:
        v = -v
    g = buckets.reindex(v.index)
    return v.groupby(g, dropna=False, group_keys=False).rank(pct=True, na_option="keep") * 100


def add_research_fit(df: pd.DataFrame, liq: pd.DataFrame, news_df: pd.DataFrame, on_log=print) -> pd.DataFrame:
    """Add horizon-specific research-fit scores.

    These are not predictions. They are weighted, peer-relative descriptions for
    different holding-period styles:
        short  = technical/momentum/liquidity heavy
        medium = balanced fundamentals + technicals
        long   = fundamentals/valuation heavy
    """
    out = df.join(news_df, how="left")

    turnover = pd.to_numeric(out.get("turnover_median"), errors="coerce")
    trades = pd.to_numeric(out.get("trades_median"), errors="coerce")
    liquidity_raw = np.log10(turnover.clip(lower=0).fillna(0) + 1) + 0.25 * np.log10(
        trades.clip(lower=0).fillna(0) + 1
    )
    out["liquidity_score"] = _rank_within_bucket(liquidity_raw, out["bucket"])

    if "news_event_score" not in out:
        out["news_event_score"] = np.nan

    for horizon, cfg in HORIZON_WEIGHTS.items():
        weights = cfg["weights"]
        vals = pd.DataFrame(index=out.index)
        used = pd.DataFrame(index=out.index)
        for col, w in weights.items():
            if col not in out.columns:
                continue
            vals[col] = pd.to_numeric(out[col], errors="coerce") * w
            used[col] = np.where(out[col].notna(), w, 0)
        wsum = used.sum(axis=1)
        raw = vals.sum(axis=1) / wsum.replace(0, np.nan)
        out[f"{horizon}_fit_raw"] = raw
        out[f"{horizon}_fit"] = _rank_within_bucket(raw, out["bucket"])

    fit_cols = ["short_fit", "medium_fit", "long_fit"]
    out["investable_score"] = out[fit_cols].max(axis=1)
    best = out[fit_cols].idxmax(axis=1).str.replace("_fit", "", regex=False)
    out["best_horizon"] = best.where(out["investable_score"].notna(), None)
    # Do not let impossible-to-trade names look investable just because factors rank well.
    out.loc[liq.reindex(out.index)["tradeable"].fillna(False) == False, fit_cols + ["investable_score"]] = np.nan
    out.loc[out["investable_score"].isna(), "best_horizon"] = None
    on_log(
        "research-fit: "
        + ", ".join(f"{h} {int(out[f'{h}_fit'].notna().sum())}" for h in ("short", "medium", "long"))
    )
    return out


def export(df: pd.DataFrame, liq: pd.DataFrame, meta: dict) -> Path:
    keep = [
        "name", "sector", "bucket", "price", "market_cap", "composite", "composite_raw",
        "band", "coverage",
        "rating_basis", "pillars_used",
        "investable_score", "best_horizon", "short_fit", "medium_fit", "long_fit",
        "liquidity_score",
        "news_event_score", "news_count_14d", "news_positive_14d", "news_negative_14d",
        "news_neutral_14d", "news_last_date", "news_last_title", "news_last_url",
        "quality", "growth", "valuation", "trend", "momentum",
        "roe", "roa", "operating_margin", "net_margin", "debt_to_equity",
        "revenue_cagr", "earnings_cagr", "pe", "pb", "ev_ebitda",
        "dividend_yield", "years_of_data",
        "above_50dma", "above_200dma", "dist_52w_high",
        "ret_6m", "ret_12m", "ann_vol", "mom_6m_risk_adj", "mom_12m_risk_adj",
        "rs_vs_nifty", "turnover_median", "trades_median", "sessions", "data_flags",
    ]
    # Emit every key even when the column is absent. A missing key becomes `undefined`
    # in JS, which slips past `!== null` guards and crashes the render; an explicit null
    # does not. Three separate UI bugs have come from a column quietly not being here.
    cols = set(df.columns)
    rows = []
    for sym, r in df.iterrows():
        row = {"symbol": sym}
        for c in keep:
            row[c] = _clean(r[c]) if c in cols else None
        rows.append(row)
    rows.sort(key=lambda r: (r.get("composite") is None, -(r.get("composite") or 0)))

    excluded = []
    for sym, r in liq[~liq["scoreable"]].iterrows():
        excluded.append(
            {
                "symbol": sym,
                "bucket": r.get("bucket"),
                "tradeable": bool(r.get("tradeable")),
                "reasons": list(r.get("liquidity_reject") or []) + list(r.get("history_reject") or []),
                "turnover_median": _clean(r.get("turnover_median")),
                "sessions": _clean(r.get("sessions")),
            }
        )

    payload = {**meta, "stocks": rows, "excluded": excluded}
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / "screen.json"
    p.write_text(json.dumps(payload, separators=(",", ":")))
    return p


def run(progress_cb=None, on_log=print, skip_fetch: bool = False) -> dict:
    """Full refresh. Returns metadata about what was produced."""
    t0 = time.time()
    u = un.build("all").set_index("symbol")
    on_log(f"universe: {len(u)} EQ-series NSE stocks")

    if skip_fetch:
        mats = bc.load(prefix="nse")
        if not mats:
            mats = refresh_prices(progress=progress_cb, on_log=on_log)
    else:
        mats = refresh_prices(progress=progress_cb, on_log=on_log)

    liq = build_liquidity(mats, u, on_log=on_log)
    df = build_scores(mats, u, liq, on_log=on_log)

    if skip_fetch:
        news_df, news_meta = news.load_summary(df.index)
        on_log(f"news/events: {news_meta['news_status']} ({news_meta['news_symbols']} symbols)")
    else:
        try:
            news_df, news_meta = news.fetch_and_summarize(df.index, days=14)
            on_log(f"news/events: {news_meta['news_rows']} announcements, {news_meta['news_symbols']} symbols")
        except Exception as e:
            cached, news_meta = news.load_summary(df.index)
            news_meta = {
                **news_meta,
                "news_status": "failed - using cached" if news_meta["news_status"] == "cached" else "failed",
                "news_error": f"{type(e).__name__}: {e}",
            }
            news_df = cached
            on_log(f"news/events: {news_meta['news_status']} ({news_meta.get('news_error')})")

    df = add_research_fit(df, liq, news_df, on_log=on_log)

    last_session = mats["close"].index[-1]
    meta = {
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "last_trading_session": str(pd.Timestamp(last_session).date()),
        "sessions": int(len(mats["close"])),
        "universe_total": int(len(u)),
        "tradeable": int(liq["tradeable"].sum()),
        "scoreable": int(liq["scoreable"].sum()),
        "scored": int(df["composite"].notna().sum()),
        "rated_full": int((df["rating_basis"] == "fundamental + technical").sum()),
        "rated_technical": int((df["rating_basis"] == "technical only").sum()),
        "source": "NSE bhavcopy (exchange EOD)",
        "elapsed_s": round(time.time() - t0, 1),
        # Shipped so the UI shows the weights actually used, not a hardcoded copy
        # that silently drifts if rating.py changes.
        "weights": dict(rating.PILLARS),
        "metrics": {k: [m for m, _ in v] for k, v in rating.METRICS.items()},
        "horizon_weights": HORIZON_WEIGHTS,
        **live_quote_status(),
        **news_meta,
    }
    export(df, liq, meta)
    on_log(f"done in {meta['elapsed_s']}s -> {meta['scored']} scored")
    return meta
