"""Large-shareholder disclosures from NSE.

WHAT THIS IS
Under SEBI's Substantial Acquisition of Shares and Takeovers (SAST) rules, anyone crossing
5% of a company — and every subsequent 2% move — must tell the exchange. Promoters must
disclose too. These filings are the closest thing retail investors get to seeing what large
holders are actually doing, and they are public and free.

WHY IT IS WORTH INGESTING RATHER THAN LINKING
The endpoint only returns a recent window, so a visitor looking today sees a few dozen
filings with no context. Cached daily, the same feed accumulates into a history nobody can
backfill later — which is precisely the asset a copy of this project cannot reproduce.

WHAT IT IS NOT
A disclosure says a stake changed, not why. Promoters pledge, funds rebalance, and estates
get divided. It is evidence to weigh, not a signal to follow.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SAST_URL = "https://www.nseindia.com/api/corporate-sast-reg29?index=equities"
FII_DII_URL = "https://www.nseindia.com/api/fiidiiTradeReact"
HOME = "https://www.nseindia.com"
REFERER = "https://www.nseindia.com/companies-listing/corporate-filings-actions"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Referer": REFERER,
}

CACHE = DATA / "sast_disclosures.pkl"
SUMMARY = DATA / "ownership_summary.pkl"

COLUMNS = [
    "symbol", "acquirerName", "acqSaleType", "acquisitionMode", "promoterType",
    "noOfShareAcq", "noOfShareSale", "totAftShare", "timestamp", "regType",
]

# Filings older than this stop describing current intent.
WINDOW_DAYS = 180


def _session() -> requests.Session:
    s = requests.Session()
    # NSE hands out cookies on the homepage and rejects API calls made without them.
    s.get(HOME, headers=HEADERS, timeout=15)
    s.get(REFERER, headers=HEADERS, timeout=15)
    return s


def fetch(timeout: int = 25) -> tuple[pd.DataFrame, dict]:
    """Fetch the current SAST window and merge it into the accumulating cache."""
    cached = pd.read_pickle(CACHE) if CACHE.exists() else pd.DataFrame(columns=COLUMNS)

    try:
        s = _session()
        payload = s.get(SAST_URL, headers=HEADERS, timeout=timeout).json()
        rows = payload.get("data", []) if isinstance(payload, dict) else payload
        fresh = pd.DataFrame(rows)
    except Exception as e:
        return cached, {
            "ownership_status": "failed - using cached" if len(cached) else "failed",
            "ownership_error": f"{type(e).__name__}: {e}",
            "ownership_rows": int(len(cached)),
        }

    if fresh.empty:
        return cached, {"ownership_status": "empty", "ownership_rows": int(len(cached))}

    for c in COLUMNS:
        if c not in fresh.columns:
            fresh[c] = None
    fresh = fresh[COLUMNS]

    combined = pd.concat([cached, fresh], ignore_index=True)
    # The same filing reappears in the window on consecutive days; keep one copy.
    combined = combined.drop_duplicates(
        subset=["symbol", "acquirerName", "timestamp", "acqSaleType", "noOfShareAcq", "noOfShareSale"],
        keep="last",
    )

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    combined.to_pickle(CACHE)
    return combined, {
        "ownership_status": "ok",
        "ownership_rows": int(len(combined)),
        "ownership_new": int(len(combined) - len(cached)),
    }


def _num(v) -> float:
    try:
        f = float(str(v).replace(",", "").strip())
        return f if np.isfinite(f) else 0.0
    except (TypeError, ValueError):
        return 0.0


def summarize(symbols: pd.Index, raw: pd.DataFrame) -> pd.DataFrame:
    """Per-symbol view of recent large-holder activity."""
    out = pd.DataFrame(
        index=pd.Index([str(s).upper() for s in symbols], name="symbol"),
        data={
            "sast_events_180d": 0,
            "sast_acquisitions": 0,
            "sast_disposals": 0,
            "sast_net_shares": 0.0,
            "sast_promoter_buying": False,
            "sast_promoter_selling": False,
            "sast_latest_holder": None,
            "sast_latest_action": None,
            "sast_latest_stake": np.nan,
            "sast_latest_date": None,
        },
    )
    if raw is None or raw.empty:
        return out

    df = raw.copy()
    df["symbol"] = df["symbol"].astype(str).str.upper().str.strip()
    df["when"] = pd.to_datetime(df["timestamp"], errors="coerce", dayfirst=True)
    cutoff = pd.Timestamp(dt.date.today() - dt.timedelta(days=WINDOW_DAYS))
    df = df[df["when"].notna() & (df["when"] >= cutoff)]
    df = df[df["symbol"].isin(out.index)]
    if df.empty:
        return out

    df["is_buy"] = df["acqSaleType"].astype(str).str.lower().str.startswith("acq")
    df["is_promoter"] = df["promoterType"].astype(str).str.upper().str.startswith("Y")
    df["shares"] = df.apply(
        lambda r: _num(r["noOfShareAcq"]) if r["is_buy"] else -_num(r["noOfShareSale"]), axis=1
    )

    g = df.groupby("symbol")
    out.loc[g.size().index, "sast_events_180d"] = g.size().astype(int)
    buys = df[df["is_buy"]].groupby("symbol").size()
    sells = df[~df["is_buy"]].groupby("symbol").size()
    out.loc[buys.index, "sast_acquisitions"] = buys.astype(int)
    out.loc[sells.index, "sast_disposals"] = sells.astype(int)
    net = g["shares"].sum()
    out.loc[net.index, "sast_net_shares"] = net.astype(float)

    prom_buy = df[df["is_promoter"] & df["is_buy"]].groupby("symbol").size()
    prom_sell = df[df["is_promoter"] & ~df["is_buy"]].groupby("symbol").size()
    out.loc[prom_buy.index, "sast_promoter_buying"] = True
    out.loc[prom_sell.index, "sast_promoter_selling"] = True

    latest = df.sort_values("when").groupby("symbol").tail(1).set_index("symbol")
    out.loc[latest.index, "sast_latest_holder"] = latest["acquirerName"].astype(str)
    out.loc[latest.index, "sast_latest_action"] = np.where(latest["is_buy"], "acquired", "sold")
    out.loc[latest.index, "sast_latest_stake"] = latest["totAftShare"].map(_num).replace(0.0, np.nan)
    out.loc[latest.index, "sast_latest_date"] = latest["when"].dt.date.astype(str)

    return out


def fetch_and_summarize(symbols: pd.Index) -> tuple[pd.DataFrame, dict]:
    raw, meta = fetch()
    summary = summarize(symbols, raw)
    meta["ownership_symbols"] = int((summary["sast_events_180d"] > 0).sum())
    SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    summary.to_pickle(SUMMARY)
    return summary, meta


def load_summary(symbols: pd.Index) -> tuple[pd.DataFrame, dict]:
    """Cached view, for refreshes that must not touch the network."""
    if SUMMARY.exists():
        df = pd.read_pickle(SUMMARY).reindex([str(s).upper() for s in symbols])
        df["sast_events_180d"] = df["sast_events_180d"].fillna(0).astype(int)
        df["sast_acquisitions"] = df["sast_acquisitions"].fillna(0).astype(int)
        df["sast_disposals"] = df["sast_disposals"].fillna(0).astype(int)
        df["sast_net_shares"] = df["sast_net_shares"].fillna(0.0)
        for c in ("sast_promoter_buying", "sast_promoter_selling"):
            df[c] = df[c].fillna(False).astype(bool)
        return df, {
            "ownership_status": "cached",
            "ownership_symbols": int((df["sast_events_180d"] > 0).sum()),
        }
    return summarize(symbols, pd.DataFrame()), {"ownership_status": "none", "ownership_symbols": 0}


def fetch_fii_dii(timeout: int = 20) -> dict:
    """Market-wide FII/DII buy-sell for the latest session."""
    try:
        s = _session()
        rows = s.get(FII_DII_URL, headers=HEADERS, timeout=timeout).json()
        out: dict = {"fii_dii_status": "ok"}
        for row in rows:
            cat = str(row.get("category", "")).strip().upper()
            if cat not in {"FII/FPI", "FII", "DII"}:
                continue
            key = "fii" if cat.startswith("FII") else "dii"
            out[f"{key}_net_cr"] = _num(row.get("netValue"))
            out[f"{key}_date"] = row.get("date")
        return out
    except Exception as e:
        return {"fii_dii_status": f"failed: {type(e).__name__}"}
