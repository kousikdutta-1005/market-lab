"""Investor view: pivot public disclosures by who filed them.

WHAT THIS CAN AND CANNOT SHOW
It is tempting to call this "portfolios of big investors". It is not, and saying so would
be the most misleading thing on the site. Indian disclosure rules are event-driven:

  - SAST filings appear when someone crosses 5%, or on further 2% moves, or when a
    promoter's own stake changes.
  - Bulk and block deals appear when a single trade crosses a size threshold.

Neither is a holdings statement. An investor sitting quietly on 4% of a company files
nothing, and nothing here would show it. So this reports **disclosed activity** — what a
named party was seen doing, and when — with the gap stated plainly rather than papered
over with a "portfolio" label.

Bulk-deal counterparties also skew heavily towards proprietary desks and market makers,
whose prints reflect market-making rather than conviction. Those are flagged so a reader
does not mistake a liquidity provider for a stock picker.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

# Names that are almost always intermediaries rather than end investors.
INTERMEDIARY = re.compile(
    r"\b(securities|broking|brokers?|capital markets|trading|prop|llp|"
    r"market\s*maker|hrti|nk securities|qe securities)\b",
    re.I,
)
# Institutional end-investors worth surfacing distinctly.
INSTITUTION = re.compile(
    r"\b(mutual fund|amc|asset management|insurance|life insurance|pension|"
    r"investment trust|fund|fpi|foreign portfolio|sovereign|gic|abu dhabi|"
    r"government of singapore|nomura|morgan stanley|goldman|blackrock|vanguard)\b",
    re.I,
)

MIN_ACTIVITY = 1


def _clean_name(s: str) -> str:
    n = re.sub(r"\s+", " ", str(s or "")).strip()
    n = re.sub(r"[.,]+$", "", n)
    return n


def _kind(name: str, promoter: bool) -> str:
    if promoter:
        return "promoter"
    if INTERMEDIARY.search(name):
        return "intermediary"
    if INSTITUTION.search(name):
        return "institution"
    return "investor"


def build(sast: pd.DataFrame | None, deals: pd.DataFrame | None, limit: int = 150) -> list[dict]:
    """Aggregate disclosures by filer. Returns rows ready for the frontend."""
    records: list[dict] = []

    if sast is not None and not sast.empty:
        df = sast.copy()
        df["name"] = df["acquirerName"].map(_clean_name)
        df["is_buy"] = df["acqSaleType"].astype(str).str.lower().str.startswith("acq")
        df["promoter"] = df["promoterType"].astype(str).str.upper().str.startswith("Y")
        df["when"] = pd.to_datetime(df["timestamp"], errors="coerce", dayfirst=True)
        for _, r in df.iterrows():
            if not r["name"]:
                continue
            records.append(
                {
                    "name": r["name"],
                    "symbol": str(r["symbol"]).upper(),
                    "action": "bought" if r["is_buy"] else "sold",
                    "promoter": bool(r["promoter"]),
                    "stake": r.get("totAftShare"),
                    "when": r["when"],
                    "source": "SAST",
                }
            )

    if deals is not None and not deals.empty and "clientName" in deals.columns:
        df = deals.copy()
        df["name"] = df["clientName"].map(_clean_name)
        df["when"] = pd.to_datetime(df.get("date"), errors="coerce", dayfirst=True)
        for _, r in df.iterrows():
            if not r["name"]:
                continue
            buy = str(r.get("buySell", "")).upper().startswith("B")
            records.append(
                {
                    "name": r["name"],
                    "symbol": str(r["symbol"]).upper(),
                    "action": "bought" if buy else "sold",
                    "promoter": False,
                    "stake": None,
                    "when": r["when"],
                    "source": str(r.get("deal_type") or "deal"),
                }
            )

    if not records:
        return []

    rec = pd.DataFrame(records)
    rec["when"] = pd.to_datetime(rec["when"], errors="coerce")

    out: list[dict] = []
    for name, g in rec.groupby("name"):
        buys = g[g["action"] == "bought"]
        sells = g[g["action"] == "sold"]
        latest = g.sort_values("when").tail(1).iloc[0]
        promoter = bool(g["promoter"].any())

        positions = []
        for sym, sg in g.groupby("symbol"):
            last = sg.sort_values("when").tail(1).iloc[0]
            stake = pd.to_numeric(pd.Series([last.get("stake")]), errors="coerce").iloc[0]
            positions.append(
                {
                    "symbol": sym,
                    "action": last["action"],
                    "events": int(len(sg)),
                    "stake": None if pd.isna(stake) else round(float(stake), 2),
                    "when": None if pd.isna(last["when"]) else str(last["when"].date()),
                    "source": last["source"],
                }
            )
        positions.sort(key=lambda p: (p["when"] or ""), reverse=True)

        out.append(
            {
                "name": name,
                "kind": _kind(name, promoter),
                "stocks": int(g["symbol"].nunique()),
                "events": int(len(g)),
                "buys": int(len(buys)),
                "sells": int(len(sells)),
                "latest_symbol": str(latest["symbol"]),
                "latest_action": str(latest["action"]),
                "latest_date": None if pd.isna(latest["when"]) else str(latest["when"].date()),
                "sources": sorted(set(g["source"].astype(str))),
                "positions": positions[:40],
            }
        )

    out = [o for o in out if o["events"] >= MIN_ACTIVITY]
    # Breadth first: someone active across several companies is more informative than a
    # single large print.
    out.sort(key=lambda o: (o["stocks"], o["events"]), reverse=True)
    return out[:limit]


# Positions kept per investor. The previous cap of 60 silently truncated the five largest
# institutions — LIC discloses 179 names — while the UI still reported the true count, so a
# portfolio looked complete when a hundred holdings were missing. Only five holders in the
# whole market exceed 60 names, so covering all of them costs about 190 extra rows.
MAX_POSITIONS = 250


def build_holdings(shp_df: pd.DataFrame | None, limit: int = 800, per_category: int = 120) -> list[dict]:
    """Pivot quarterly shareholding filings into per-investor portfolios.

    Unlike build(), which reports disclosed *events*, this is what each named holder
    actually owned on the filing date — the dataset behind a "superstar investor" view.
    Promoters are excluded: a promoter's stake in their own company is not a portfolio.
    """
    if shp_df is None or shp_df.empty:
        return []

    df = shp_df[~shp_df["is_promoter"]].copy()
    if df.empty:
        return []
    df["pct"] = pd.to_numeric(df["pct"], errors="coerce")
    df["shares"] = pd.to_numeric(df["shares"], errors="coerce")

    out: list[dict] = []
    for key, g in df.groupby("holder_key"):
        if not key:
            continue
        positions = (
            g.sort_values("pct", ascending=False)
            .drop_duplicates("symbol")
            .head(MAX_POSITIONS)
        )
        cat = (
            g["category"].mode().iloc[0]
            if "category" in g and not g["category"].dropna().empty
            else _kind(str(positions["holder"].iloc[0]), promoter=False)
        )
        out.append(
            {
                "name": str(positions["holder"].iloc[0]),
                "kind": str(cat),
                "stocks": int(g["symbol"].nunique()),
                "as_of": str(g["as_of"].dropna().max()) if "as_of" in g else None,
                "largest_stake": round(float(positions["pct"].max()), 2),
                "holdings": [
                    {
                        "symbol": str(r["symbol"]),
                        "pct": None if pd.isna(r["pct"]) else round(float(r["pct"]), 2),
                        "shares": None if pd.isna(r["shares"]) else int(r["shares"]),
                    }
                    for _, r in positions.iterrows()
                ],
            }
        )

    out.sort(key=lambda o: (o["stocks"], o["largest_stake"]), reverse=True)

    kept: list[dict] = []
    seen: dict[str, int] = {}
    for o in out:
        c = o["kind"]
        if seen.get(c, 0) >= per_category:
            continue
        seen[c] = seen.get(c, 0) + 1
        kept.append(o)
        if len(kept) >= limit:
            break
    return kept
