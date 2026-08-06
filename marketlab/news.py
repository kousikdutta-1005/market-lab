"""Official market event/news layer from NSE corporate announcements.

This is deliberately *not* a scraped social-media or random-news sentiment feed. NSE
corporate announcements are official, timestamped, market-wide disclosures, and the API
can be fetched in bulk instead of hammering one page per stock.

The resulting score is an event-risk / event-tone descriptor, not a prediction:
    50 = no recent official event or neutral event mix
    >50 = recent disclosures whose titles/text match constructive categories
    <50 = recent disclosures whose titles/text match risk categories
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
URL = "https://www.nseindia.com/api/corporate-announcements"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
}

POSITIVE = re.compile(
    r"\b(?:"
    r"order|orders|award|awarded|wins?|bagged|contract|approval|approved|license|licence|"
    r"dividend|buyback|bonus|split|upgrade|upgraded|capacity|commissioning|expansion|"
    r"acquisition|merger|amalgamation|fund raising|rights issue|preferential issue"
    r")\b",
    re.I,
)

NEGATIVE = re.compile(
    r"\b(?:"
    r"default|downgrade|downgraded|penalty|fine|fraud|forensic|insolvency|bankruptcy|"
    r"liquidation|winding up|show cause|litigation|resignation|auditor resignation|"
    r"qualified opinion|adverse opinion|fire|accident|strike|lockout|suspension|"
    r"revocation|termination|pledge|encumbrance|delay|non[- ]?compliance"
    r")\b",
    re.I,
)

NOISY_NEUTRAL = re.compile(
    r"\b(?:"
    r"newspaper publication|loss of share certificate|certificate|investor grievance|"
    r"compliance certificate|scrutinizer|transcript|analyst meet|investor meet|"
    r"shareholders meeting|agm|egm|postal ballot|closure of trading window"
    r")\b",
    re.I,
)


def fetch(days: int = 14, end: dt.date | None = None, timeout: int = 25) -> pd.DataFrame:
    """Fetch recent NSE corporate announcements for all equities."""
    end = end or dt.date.today()
    start = end - dt.timedelta(days=days)
    params = {
        "index": "equities",
        "from_date": start.strftime("%d-%m-%Y"),
        "to_date": end.strftime("%d-%m-%Y"),
    }
    r = requests.get(URL, params=params, headers=HEADERS, timeout=timeout)
    r.raise_for_status()
    rows = r.json()
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(
            columns=["symbol", "sort_date", "desc", "attchmntText", "attchmntFile", "tone"]
        )
    df["symbol"] = df["symbol"].astype(str).str.upper().str.strip()
    df["sort_date"] = pd.to_datetime(df.get("sort_date"), errors="coerce")
    text = (
        df.get("desc", "").fillna("").astype(str)
        + " "
        + df.get("attchmntText", "").fillna("").astype(str)
    )
    df["tone"] = np.select(
        [text.str.contains(NEGATIVE), text.str.contains(POSITIVE), text.str.contains(NOISY_NEUTRAL)],
        [-1, 1, 0],
        default=0,
    )
    return df


def summarize(df: pd.DataFrame, symbols: pd.Index, now: dt.datetime | None = None) -> pd.DataFrame:
    """Collapse announcement rows into per-symbol event features."""
    now = now or dt.datetime.now()
    idx = pd.Index([str(s).upper() for s in symbols], name="symbol")
    out = pd.DataFrame(index=idx)
    out["news_count_14d"] = 0
    out["news_positive_14d"] = 0
    out["news_negative_14d"] = 0
    out["news_neutral_14d"] = 0
    out["news_last_date"] = pd.NaT
    out["news_last_title"] = ""
    out["news_last_url"] = ""
    out["news_event_score"] = 50.0

    if df.empty:
        return out

    d = df[df["symbol"].isin(idx)].copy()
    if d.empty:
        return out
    d["age_days"] = (pd.Timestamp(now) - d["sort_date"]).dt.total_seconds() / 86400
    d["recency_weight"] = np.exp(-d["age_days"].clip(lower=0) / 7.0)

    grouped = d.groupby("symbol", sort=False)
    out.loc[grouped.size().index, "news_count_14d"] = grouped.size()
    out.loc[grouped["tone"].apply(lambda s: (s > 0).sum()).index, "news_positive_14d"] = grouped[
        "tone"
    ].apply(lambda s: (s > 0).sum())
    out.loc[grouped["tone"].apply(lambda s: (s < 0).sum()).index, "news_negative_14d"] = grouped[
        "tone"
    ].apply(lambda s: (s < 0).sum())
    out.loc[grouped["tone"].apply(lambda s: (s == 0).sum()).index, "news_neutral_14d"] = grouped[
        "tone"
    ].apply(lambda s: (s == 0).sum())

    pos = d[d["tone"] > 0].groupby("symbol")["recency_weight"].sum()
    neg = d[d["tone"] < 0].groupby("symbol")["recency_weight"].sum()
    total = d.groupby("symbol")["recency_weight"].sum()
    symbols_seen = total.index
    # Positive events nudge up; negative/risk events penalise harder. High raw volume of
    # announcements is not automatically good, so cap the effect tightly.
    score = 50 + 18 * pos.reindex(symbols_seen, fill_value=0) - 28 * neg.reindex(symbols_seen, fill_value=0)
    score = score - np.maximum(total.reindex(symbols_seen, fill_value=0) - 4, 0) * 1.5
    out.loc[symbols_seen, "news_event_score"] = score.clip(0, 100)

    latest = d.sort_values("sort_date").groupby("symbol").tail(1).set_index("symbol")
    out.loc[latest.index, "news_last_date"] = latest["sort_date"]
    out.loc[latest.index, "news_last_title"] = latest.get("desc", "").fillna("").astype(str)
    out.loc[latest.index, "news_last_url"] = latest.get("attchmntFile", "").fillna("").astype(str)
    return out


def fetch_and_summarize(symbols: pd.Index, days: int = 14) -> tuple[pd.DataFrame, dict]:
    """Fetch announcements and return per-symbol features plus refresh metadata."""
    raw = fetch(days=days)
    DATA.mkdir(parents=True, exist_ok=True)
    raw.to_pickle(DATA / "nse_announcements.pkl")
    summary = summarize(raw, symbols)
    summary.to_pickle(DATA / "news_summary.pkl")
    meta = {
        "news_source": "NSE corporate announcements",
        "news_window_days": days,
        "news_rows": int(len(raw)),
        "news_symbols": int(summary["news_count_14d"].gt(0).sum()),
        "news_status": "ok",
    }
    return summary, meta


def load_summary(symbols: pd.Index) -> tuple[pd.DataFrame, dict]:
    """Load cached summary if present; otherwise return an explicit unavailable layer."""
    p = DATA / "news_summary.pkl"
    if p.exists():
        df = pd.read_pickle(p)
        df.index = df.index.astype(str).str.upper()
        df = df.reindex([str(s).upper() for s in symbols])
        return df, {
            "news_source": "NSE corporate announcements",
            "news_window_days": 14,
            "news_rows": None,
            "news_symbols": int(df["news_count_14d"].fillna(0).gt(0).sum()) if "news_count_14d" in df else 0,
            "news_status": "cached",
        }
    idx = pd.Index([str(s).upper() for s in symbols], name="symbol")
    df = pd.DataFrame(index=idx)
    df["news_event_score"] = np.nan
    df["news_count_14d"] = 0
    df["news_positive_14d"] = 0
    df["news_negative_14d"] = 0
    df["news_neutral_14d"] = 0
    df["news_last_date"] = pd.NaT
    df["news_last_title"] = ""
    df["news_last_url"] = ""
    return df, {
        "news_source": "NSE corporate announcements",
        "news_window_days": 14,
        "news_rows": 0,
        "news_symbols": 0,
        "news_status": "unavailable",
    }
