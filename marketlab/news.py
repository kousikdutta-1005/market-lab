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
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
URL = "https://www.nseindia.com/api/corporate-announcements"
BSE_API = "https://api.bseindia.com/BseIndiaAPI/api"
BSE_ATTACH = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/{name}"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
}
BSE_HEADERS = {
    "User-Agent": HEADERS["User-Agent"],
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://www.bseindia.com/corporates/ann",
    "Origin": "https://www.bseindia.com",
}
BSE_COLUMNS = ["symbol", "sort_date", "desc", "attchmntText", "attchmntFile", "source", "tone"]
BSE_MASTER_TTL_S = 7 * 24 * 60 * 60

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


def fetch_nse(days: int = 14, end: dt.date | None = None, timeout: int = 25) -> pd.DataFrame:
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
    df["source"] = "NSE"
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


def _empty_bse_master() -> pd.DataFrame:
    return pd.DataFrame(columns=["SCRIP_CD", "ISIN_NUMBER", "scrip_id"])


def _normalize_bse_master(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty or not {"SCRIP_CD", "ISIN_NUMBER", "scrip_id"}.issubset(df.columns):
        return _empty_bse_master()
    df = df.copy()
    df["SCRIP_CD"] = pd.to_numeric(df["SCRIP_CD"], errors="coerce").astype("Int64")
    df["ISIN_NUMBER"] = df["ISIN_NUMBER"].astype(str).str.strip()
    df["scrip_id"] = df["scrip_id"].astype(str).str.upper().str.strip()
    return df


def bse_scrip_master(timeout: int = 4) -> pd.DataFrame:
    """BSE active equity master, used to map SCRIP_CD to NSE symbols via ISIN."""
    cache = DATA / "bse_scrip_master.pkl"
    if cache.exists() and time.time() - cache.stat().st_mtime < BSE_MASTER_TTL_S:
        try:
            return _normalize_bse_master(pd.read_pickle(cache))
        except (OSError, EOFError, ValueError):
            pass

    try:
        r = requests.get(
            f"{BSE_API}/ListofScripData/w",
            params={"Group": "", "Scripcode": "", "industry": "", "segment": "Equity", "status": "Active"},
            headers=BSE_HEADERS,
            timeout=timeout,
        )
        r.raise_for_status()
        df = pd.DataFrame(r.json())
        DATA.mkdir(parents=True, exist_ok=True)
        df.to_pickle(cache)
    except (requests.RequestException, ValueError, OSError):
        if cache.exists():
            try:
                return _normalize_bse_master(pd.read_pickle(cache))
            except (OSError, EOFError, ValueError):
                return _empty_bse_master()
        return _empty_bse_master()
    return _normalize_bse_master(df)


def _bse_day(day: dt.date, timeout: int = 8, max_pages: int = 8) -> pd.DataFrame:
    """Fetch one BSE announcement day. The endpoint is unreliable for multi-day ranges."""
    rows: list[dict] = []
    params = {
        "strCat": "-1",
        "strPrevDate": day.strftime("%Y%m%d"),
        "strScrip": "",
        "strSearch": "P",
        "strToDate": day.strftime("%Y%m%d"),
        "strType": "C",
        "subcategory": "-1",
    }
    for page in range(1, max_pages + 1):
        r = requests.get(
            f"{BSE_API}/AnnSubCategoryGetData/w",
            params={"pageno": page, **params},
            headers=BSE_HEADERS,
            timeout=timeout,
        )
        r.raise_for_status()
        data = r.json() if r.text.strip() else {}
        table = data.get("Table") or []
        if not table:
            break
        rows.extend(table)
        total_pages = int(table[0].get("TotalPageCnt") or page)
        if page >= total_pages:
            break
    return pd.DataFrame(rows)


def fetch_bse(
    symbols: pd.Index,
    universe: pd.DataFrame,
    days: int = 14,
    end: dt.date | None = None,
) -> pd.DataFrame:
    """Fetch recent BSE announcements and map them into NSE symbols."""
    end = end or dt.date.today()
    master = bse_scrip_master()
    if master.empty:
        return pd.DataFrame(columns=BSE_COLUMNS)

    u = universe.reset_index() if "symbol" not in universe.columns else universe.copy()
    isin_to_symbol = (
        u.dropna(subset=["isin"]).assign(isin=lambda x: x["isin"].astype(str).str.strip()).set_index("isin")["symbol"]
    )
    scrip_to_symbol = master.set_index("SCRIP_CD")["ISIN_NUMBER"].map(isin_to_symbol).dropna()
    fallback = master.set_index("SCRIP_CD")["scrip_id"]

    frames = []
    # BSE's current endpoint is fast for one day but unreliable for multi-day ranges.
    # Keep refresh responsive: NSE supplies the 14-day backbone, BSE adds same-day
    # disclosures and BSE-only edge cases.
    for i in range(1):
        d = end - dt.timedelta(days=i)
        try:
            day = _bse_day(d, timeout=5, max_pages=1)
        except (requests.RequestException, ValueError):
            continue
        if not day.empty:
            frames.append(day)
    if not frames:
        return pd.DataFrame(columns=BSE_COLUMNS)

    raw = pd.concat(frames, ignore_index=True)
    raw["SCRIP_CD"] = pd.to_numeric(raw["SCRIP_CD"], errors="coerce").astype("Int64")
    raw["symbol"] = raw["SCRIP_CD"].map(scrip_to_symbol)
    raw["symbol"] = raw["symbol"].fillna(raw["SCRIP_CD"].map(fallback))
    raw["symbol"] = raw["symbol"].astype(str).str.upper().str.strip()
    raw = raw[raw["symbol"].isin(pd.Index(symbols).astype(str).str.upper())].copy()
    raw["sort_date"] = pd.to_datetime(raw.get("NEWS_DT"), errors="coerce")
    raw["desc"] = raw.get("CATEGORYNAME", "").fillna("").astype(str)
    raw["attchmntText"] = (
        raw.get("NEWSSUB", "").fillna("").astype(str)
        + " "
        + raw.get("HEADLINE", "").fillna("").astype(str)
        + " "
        + raw.get("SUBCATNAME", "").fillna("").astype(str)
    )
    raw["attchmntFile"] = raw.get("ATTACHMENTNAME", "").fillna("").astype(str).map(
        lambda x: BSE_ATTACH.format(name=x) if x else ""
    )
    raw["source"] = "BSE"
    text = raw["desc"] + " " + raw["attchmntText"]
    raw["tone"] = np.select(
        [text.str.contains(NEGATIVE, na=False), text.str.contains(POSITIVE, na=False), text.str.contains(NOISY_NEUTRAL, na=False)],
        [-1, 1, 0],
        default=0,
    )
    return raw[["symbol", "sort_date", "desc", "attchmntText", "attchmntFile", "source", "tone"]]


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
    d["sort_date"] = pd.to_datetime(d["sort_date"], errors="coerce").dt.tz_localize(None)
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


def fetch_and_summarize(
    symbols: pd.Index,
    days: int = 14,
    universe: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Fetch announcements and return per-symbol features plus refresh metadata."""
    nse_raw = fetch_nse(days=days)
    bse_raw = pd.DataFrame()
    if universe is not None:
        bse_raw = fetch_bse(symbols, universe, days=days)
    raw = pd.concat([nse_raw, bse_raw], ignore_index=True)
    if not raw.empty:
        raw = raw.drop_duplicates(subset=["symbol", "sort_date", "attchmntText", "source"])
    DATA.mkdir(parents=True, exist_ok=True)
    raw.to_pickle(DATA / "official_announcements.pkl")
    summary = summarize(raw, symbols)
    summary.to_pickle(DATA / "news_summary.pkl")
    meta = {
        "news_source": "NSE + BSE corporate announcements",
        "news_window_days": days,
        "news_rows": int(len(raw)),
        "news_nse_rows": int(len(nse_raw)),
        "news_bse_rows": int(len(bse_raw)),
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
            "news_source": "NSE + BSE corporate announcements",
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
        "news_source": "NSE + BSE corporate announcements",
        "news_window_days": 14,
        "news_rows": 0,
        "news_symbols": 0,
        "news_status": "unavailable",
    }
