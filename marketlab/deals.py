"""Official NSE large-deal snapshot.

This is not a tips feed. Bulk and block deals are useful because they show where
reported market activity was unusually concentrated, but the same stock can have
large buyers and large sellers on the same day. Treat this as evidence to inspect,
not as direction.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
URL = "https://www.nseindia.com/api/snapshot-capital-market-largedeal"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://www.nseindia.com/market-data/large-deals",
}

OUT_COLUMNS = [
    "deal_count",
    "bulk_deal_count",
    "block_deal_count",
    "short_deal_count",
    "deal_value",
    "bulk_deal_value",
    "block_deal_value",
    "deal_net_qty",
    "deal_latest_client",
    "deal_latest_type",
    "deal_latest_side",
    "deal_latest_date",
]


def _empty(symbols: pd.Index) -> pd.DataFrame:
    out = pd.DataFrame(index=pd.Index([str(s).upper() for s in symbols], name="symbol"))
    for c in OUT_COLUMNS:
        out[c] = "" if c.startswith("deal_latest") else 0.0
    out["deal_latest_date"] = pd.NaT
    return out


def fetch(timeout: int = 20) -> tuple[pd.DataFrame, dict]:
    """Fetch raw NSE bulk/block/short-deal rows."""
    r = requests.get(URL, headers=HEADERS, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    frames: list[pd.DataFrame] = []
    for key, label in (
        ("BULK_DEALS_DATA", "bulk"),
        ("BLOCK_DEALS_DATA", "block"),
        ("SHORT_DEALS_DATA", "short"),
    ):
        rows = data.get(key) or []
        if rows:
            f = pd.DataFrame(rows)
            f["deal_type"] = label
            frames.append(f)
    if not frames:
        return pd.DataFrame(), {
            "deal_source": "NSE large-deal snapshot",
            "deal_status": "ok",
            "deal_rows": 0,
            "deal_as_on": data.get("as_on_date"),
        }
    raw = pd.concat(frames, ignore_index=True)
    raw["symbol"] = raw["symbol"].astype(str).str.upper().str.strip()
    raw["qty"] = pd.to_numeric(raw.get("qty"), errors="coerce").fillna(0)
    raw["watp"] = pd.to_numeric(raw.get("watp"), errors="coerce")
    raw["value"] = raw["qty"] * raw["watp"].fillna(0)
    raw["buySell"] = raw.get("buySell", "").fillna("").astype(str).str.upper().str.strip()
    raw["signed_qty"] = np.select(
        [raw["buySell"].eq("BUY"), raw["buySell"].eq("SELL")],
        [raw["qty"], -raw["qty"]],
        default=0,
    )
    raw["date"] = pd.to_datetime(raw.get("date"), errors="coerce")
    return raw, {
        "deal_source": "NSE large-deal snapshot",
        "deal_status": "ok",
        "deal_rows": int(len(raw)),
        "deal_as_on": data.get("as_on_date"),
    }


def summarize(symbols: pd.Index, raw: pd.DataFrame) -> pd.DataFrame:
    """Collapse raw large-deal rows into per-symbol activity fields."""
    out = _empty(symbols)
    if raw.empty:
        return out
    idx = out.index
    d = raw[raw["symbol"].isin(idx)].copy()
    if d.empty:
        return out

    grouped = d.groupby("symbol", sort=False)
    out.loc[grouped.size().index, "deal_count"] = grouped.size()
    out.loc[grouped["value"].sum().index, "deal_value"] = grouped["value"].sum()
    out.loc[grouped["signed_qty"].sum().index, "deal_net_qty"] = grouped["signed_qty"].sum()

    for deal_type, prefix in (("bulk", "bulk_deal"), ("block", "block_deal"), ("short", "short_deal")):
        part = d[d["deal_type"].eq(deal_type)]
        if part.empty:
            continue
        g = part.groupby("symbol", sort=False)
        out.loc[g.size().index, f"{prefix}_count"] = g.size()
        if f"{prefix}_value" in out:
            out.loc[g["value"].sum().index, f"{prefix}_value"] = g["value"].sum()

    latest = d.sort_values("date").groupby("symbol").tail(1).set_index("symbol")
    out.loc[latest.index, "deal_latest_client"] = latest.get("clientName", "").fillna("").astype(str)
    out.loc[latest.index, "deal_latest_type"] = latest["deal_type"].astype(str)
    out.loc[latest.index, "deal_latest_side"] = latest["buySell"].astype(str)
    out.loc[latest.index, "deal_latest_date"] = latest["date"]
    return out


def fetch_and_summarize(symbols: pd.Index) -> tuple[pd.DataFrame, dict]:
    try:
        raw, meta = fetch()
        DATA.mkdir(parents=True, exist_ok=True)
        raw.to_pickle(DATA / "nse_large_deals.pkl")
        summary = summarize(symbols, raw)
        summary.to_pickle(DATA / "large_deal_summary.pkl")
        meta["deal_symbols"] = int(summary["deal_count"].gt(0).sum())
        return summary, meta
    except (requests.RequestException, ValueError, OSError) as e:
        cached = DATA / "large_deal_summary.pkl"
        if cached.exists():
            df = pd.read_pickle(cached).reindex([str(s).upper() for s in symbols]).fillna(0)
            return df, {
                "deal_source": "NSE large-deal snapshot",
                "deal_status": "failed - using cached",
                "deal_error": f"{type(e).__name__}: {e}",
                "deal_rows": None,
                "deal_symbols": int(df["deal_count"].gt(0).sum()) if "deal_count" in df else 0,
                "deal_as_on": None,
            }
        return _empty(symbols), {
            "deal_source": "NSE large-deal snapshot",
            "deal_status": "failed",
            "deal_error": f"{type(e).__name__}: {e}",
            "deal_rows": 0,
            "deal_symbols": 0,
            "deal_as_on": None,
        }
