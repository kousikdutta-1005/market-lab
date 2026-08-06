"""Risk and surveillance context from free public sources plus local diagnostics."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FO_BAN_URL = "https://nsearchives.nseindia.com/content/fo/fo_secban.csv"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Accept": "text/csv,text/plain,*/*",
    "Referer": "https://www.nseindia.com/",
}


def fetch_fo_ban(timeout: int = 15) -> tuple[set[str], dict]:
    try:
        r = requests.get(FO_BAN_URL, headers=HEADERS, timeout=timeout)
        r.raise_for_status()
        lines = [x.strip() for x in r.text.splitlines() if x.strip()]
        symbols: set[str] = set()
        for line in lines[1:]:
            parts = [p.strip().upper() for p in line.split(",") if p.strip()]
            if len(parts) >= 2 and parts[1] != "SYMBOL":
                symbols.add(parts[1])
        return symbols, {
            "risk_source": "NSE F&O ban + local liquidity/volatility diagnostics",
            "risk_status": "ok",
            "fo_ban_count": len(symbols),
        }
    except requests.RequestException as e:
        return set(), {
            "risk_source": "NSE F&O ban + local liquidity/volatility diagnostics",
            "risk_status": "partial",
            "risk_error": f"{type(e).__name__}: {e}",
            "fo_ban_count": 0,
        }


def build(df: pd.DataFrame, liq: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    fo_ban, meta = fetch_fo_ban()
    out = pd.DataFrame(index=df.index)
    out["fno_ban"] = out.index.to_series().isin(fo_ban)
    penalty = pd.Series(0.0, index=out.index)
    flags = pd.Series([[] for _ in out.index], index=out.index, dtype="object")

    def add(mask: pd.Series, label: str, points: float) -> None:
        nonlocal penalty, flags
        mask = mask.reindex(out.index).fillna(False).astype(bool)
        penalty.loc[mask] += points
        for sym in flags.index[mask]:
            flags.at[sym] = flags.at[sym] + [label]

    add(out["fno_ban"], "F&O ban", 35)
    add(pd.to_numeric(df.get("ann_vol"), errors="coerce") > 0.75, "high volatility", 18)
    add(pd.to_numeric(df.get("ann_vol"), errors="coerce") > 1.10, "extreme volatility", 12)
    add(pd.to_numeric(df.get("dist_52w_high"), errors="coerce") < -40, "deep drawdown", 12)
    add(pd.to_numeric(df.get("coverage"), errors="coerce") < 0.70, "thin fundamentals", 10)
    add(df.get("data_flags", pd.Series("", index=df.index)).fillna("").astype(str).ne(""), "data quality flag", 12)
    add(pd.to_numeric(liq.reindex(out.index).get("turnover_median"), errors="coerce") < 20_000_000, "thin liquidity", 16)
    if "news_negative_14d" in df:
        add(pd.to_numeric(df["news_negative_14d"], errors="coerce") > 0, "negative official event", 15)

    out["risk_score"] = penalty.clip(0, 100)
    out["risk_level"] = pd.cut(
        out["risk_score"],
        [-0.01, 19.99, 44.99, 100.01],
        labels=["Low", "Watch", "High"],
    ).astype(str)
    out["risk_flags"] = flags.map(lambda xs: ", ".join(xs))
    meta["high_risk_symbols"] = int(out["risk_level"].eq("High").sum())
    DATA.mkdir(parents=True, exist_ok=True)
    out.to_pickle(DATA / "risk_summary.pkl")
    return out, meta
