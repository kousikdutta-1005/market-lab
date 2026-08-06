"""The investable Indian equity universe, and how to slice it.

Sources, all public and keyless:
  * NSE index constituent CSVs  — https://archives.nseindia.com/content/indices/
  * NSE full equity list        — https://archives.nseindia.com/content/equities/EQUITY_L.csv

WHAT "WHOLE MARKET" ACTUALLY MEANS
NSE lists ~2,400 securities. Only the EQ series (~2,078) trades normally:
  * EQ — normal rolling settlement
  * BE — trade-to-trade / surveillance: delivery compulsory, no intraday netting
  * BZ — surveillance, typically with additional restrictions
BE and BZ are excluded by default. They are not "cheap stocks nobody noticed"; they are
stocks the exchange has placed under restriction, and treating them as ordinary holdings
misrepresents how tradeable they are.

BSE-exclusive listings are not covered. Almost every liquid Indian company is on NSE,
and BSE-only names are overwhelmingly tiny and thinly traded.

SIZE BUCKETS
Assigned from official index membership rather than from a market-cap number we compute
ourselves, so they match SEBI's own definition:
    large  Nifty 100
    mid    Nifty Midcap 150      (ranks 101-250)
    small  Nifty Smallcap 250    (ranks 251-500)
    micro  Nifty Microcap 250    (ranks 501-750)
    nano   listed, in no index   (below rank ~750)
This matters because percentile ranks are only meaningful within a bucket. Comparing a
nano-cap's valuation percentile against Reliance's is not a comparison.
"""

from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
import requests

from . import cache

DATA = Path(__file__).resolve().parent.parent / "data"

_BASE = "https://archives.nseindia.com/content"

# NSE's archive host rejects non-browser agents.
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/csv,text/plain,*/*",
}

INDEX_FILES = {
    "nifty50": "ind_nifty50list.csv",
    "nifty100": "ind_nifty100list.csv",
    "nifty200": "ind_nifty200list.csv",
    "nifty500": "ind_nifty500list.csv",
    "total750": "ind_niftytotalmarket_list.csv",
    "midcap150": "ind_niftymidcap150list.csv",
    "smallcap250": "ind_niftysmallcap250list.csv",
    "microcap250": "ind_niftymicrocap250_list.csv",
}

# Broadest first: a stock takes the bucket of the narrowest index it belongs to.
BUCKET_ORDER = [
    ("large", "nifty100"),
    ("mid", "midcap150"),
    ("small", "smallcap250"),
    ("micro", "microcap250"),
]

TRADEABLE_SERIES = {"EQ"}

_WEEK = 7 * 86400


def _fetch_text(url: str, max_age_s: int) -> str:
    hit = cache.get(url, max_age_s, suffix=".csv")
    if hit is not None:
        return hit
    r = requests.get(url, headers=UA, timeout=45)
    r.raise_for_status()
    text = r.text
    if "<html" in text[:400].lower():
        raise RuntimeError(f"{url} returned HTML, not CSV — endpoint may have moved")
    cache.put(url, text, suffix=".csv")
    return text


def _index_csv(name: str, max_age_s: int = _WEEK) -> pd.DataFrame:
    if name not in INDEX_FILES:
        raise KeyError(f"unknown index {name!r}; known: {', '.join(sorted(INDEX_FILES))}")
    text = _fetch_text(f"{_BASE}/indices/{INDEX_FILES[name]}", max_age_s)
    df = pd.read_csv(io.StringIO(text))
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df["symbol"] = df["symbol"].astype(str).str.strip()
    # NSE leaves DUMMY* placeholder rows in its own index CSVs (artefacts of pending
    # corporate actions). They are not tradeable securities and have no price history.
    # Taking an index CSV at face value means silently carrying phantom constituents.
    df = df[~df["symbol"].str.upper().str.startswith("DUMMY")]
    return df.reset_index(drop=True)


def index_members(name: str, max_age_s: int = _WEEK) -> list[str]:
    """Symbols in an NSE index, live from NSE (not a hardcoded list)."""
    return _index_csv(name, max_age_s)["symbol"].tolist()


def all_listed(max_age_s: int = _WEEK) -> pd.DataFrame:
    """Every NSE-listed security, with series and listing date."""
    text = _fetch_text(f"{_BASE}/equities/EQUITY_L.csv", max_age_s)
    df = pd.read_csv(io.StringIO(text))
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df = df.rename(columns={"name_of_company": "company_name", "isin_number": "isin"})
    for c in ("symbol", "series", "company_name", "isin"):
        if c in df.columns:
            df[c] = df[c].astype(str).str.strip()
    df["date_of_listing"] = pd.to_datetime(
        df["date_of_listing"].astype(str).str.strip(), format="%d-%b-%Y", errors="coerce"
    )
    return df


def build(tier: str = "all", max_age_s: int = _WEEK) -> pd.DataFrame:
    """The universe as a DataFrame: symbol, ticker, company_name, industry, bucket, ...

    tier: one of the INDEX_FILES keys, or "all" for every EQ-series NSE listing.
    """
    listed = all_listed(max_age_s)
    listed = listed[listed["series"].isin(TRADEABLE_SERIES)].copy()

    if tier == "all":
        base = listed
    else:
        members = set(index_members(tier, max_age_s))
        base = listed[listed["symbol"].isin(members)].copy()
        missing = members - set(base["symbol"])
        if missing:
            # Index members absent from the EQ list are usually recent series changes.
            base.attrs["excluded_non_eq"] = sorted(missing)

    cols = ["symbol", "company_name", "date_of_listing", "isin"]
    out = base[[c for c in cols if c in base.columns]].copy()

    # Industry only exists on the index CSVs, so take it from the broadest one available.
    try:
        tm = _index_csv("total750", max_age_s)[["symbol", "industry"]]
        out = out.merge(tm, on="symbol", how="left")
    except Exception:
        out["industry"] = pd.NA

    bucket = pd.Series("nano", index=out.index, dtype="object")
    assigned = pd.Series(False, index=out.index)
    for label, idx_name in BUCKET_ORDER:
        try:
            members = set(index_members(idx_name, max_age_s))
        except Exception:
            continue
        hit = out["symbol"].isin(members) & ~assigned
        bucket[hit] = label
        assigned |= hit
    out["bucket"] = bucket

    out["ticker"] = out["symbol"] + ".NS"
    out = out.sort_values("symbol").reset_index(drop=True)
    return out


BUCKET_SEQ = ["large", "mid", "small", "micro", "nano"]


def summary(u: pd.DataFrame) -> pd.DataFrame:
    """Counts per size bucket, in size order."""
    counts = u["bucket"].value_counts()
    return pd.DataFrame(
        {"stocks": [int(counts.get(b, 0)) for b in BUCKET_SEQ]},
        index=pd.Index(BUCKET_SEQ, name="bucket"),
    )
