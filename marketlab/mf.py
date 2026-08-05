"""Indian mutual fund data.

Sources (both free, no auth):
  * AMFI NAVAll.txt  -> full universe snapshot (scheme code, name, category, NAV)
  * api.mfapi.in     -> full historical NAV series per scheme code
"""

from __future__ import annotations

import io
import re

import pandas as pd
import requests

from . import cache

AMFI_NAV_ALL = "https://portal.amfiindia.com/spages/NAVAll.txt"
MFAPI = "https://api.mfapi.in/mf/{code}"

_HEADERS = {"User-Agent": "market-lab/0.1 (personal research)"}
_CATEGORY_RE = re.compile(r"^(Open|Close|Interval)\s+Ended\s+Schemes\s*\((.+)\)\s*$", re.I)


def _fetch_navall(max_age_s: float) -> str:
    cached = cache.get(AMFI_NAV_ALL, max_age_s, suffix=".txt")
    if cached is not None:
        return cached
    resp = requests.get(AMFI_NAV_ALL, headers=_HEADERS, timeout=120)
    resp.raise_for_status()
    cache.put(AMFI_NAV_ALL, resp.text, suffix=".txt")
    return resp.text


def universe(max_age_s: float = 6 * 3600) -> pd.DataFrame:
    """Every scheme AMFI publishes, with today's NAV.

    Returns columns: scheme_code, isin_growth, isin_reinvest, scheme_name,
    nav, nav_date, scheme_type, category, fund_house.
    """
    text = _fetch_navall(max_age_s)

    rows: list[dict] = []
    scheme_type = category = fund_house = ""

    for raw in io.StringIO(text):
        line = raw.strip()
        if not line or line.startswith("Scheme Code"):
            continue

        if ";" not in line:
            m = _CATEGORY_RE.match(line)
            if m:
                scheme_type, category = m.group(1).title() + " Ended", m.group(2).strip()
            else:
                fund_house = line
            continue

        parts = line.split(";")
        if len(parts) < 6:
            continue
        code, isin_g, isin_r, name, nav, date = (p.strip() for p in parts[:6])
        rows.append(
            {
                "scheme_code": pd.to_numeric(code, errors="coerce"),
                "isin_growth": None if isin_g in ("-", "") else isin_g,
                "isin_reinvest": None if isin_r in ("-", "") else isin_r,
                "scheme_name": name,
                "nav": pd.to_numeric(nav, errors="coerce"),
                "nav_date": date,
                "scheme_type": scheme_type,
                "category": category,
                "fund_house": fund_house,
            }
        )

    df = pd.DataFrame(rows).dropna(subset=["scheme_code"])
    df["scheme_code"] = df["scheme_code"].astype(int)
    df["nav_date"] = pd.to_datetime(df["nav_date"], format="%d-%b-%Y", errors="coerce")
    return df.reset_index(drop=True)


def search(query: str, direct_only: bool = False, growth_only: bool = False) -> pd.DataFrame:
    """Substring search over scheme names. All terms must match, any order."""
    df = universe()
    terms = query.lower().split()
    name = df["scheme_name"].str.lower()
    mask = pd.Series(True, index=df.index)
    for t in terms:
        mask &= name.str.contains(re.escape(t), na=False)
    if direct_only:
        mask &= name.str.contains("direct", na=False)
    if growth_only:
        mask &= name.str.contains("growth", na=False)
    cols = ["scheme_code", "scheme_name", "nav", "nav_date", "category", "fund_house"]
    return df.loc[mask, cols].reset_index(drop=True)


def nav_history(scheme_code: int, max_age_s: float = 12 * 3600) -> pd.DataFrame:
    """Full NAV history for a scheme. Returns DatetimeIndex + 'nav' column, ascending."""
    url = MFAPI.format(code=scheme_code)
    payload = cache.get(url, max_age_s)
    if payload is None:
        resp = requests.get(url, headers=_HEADERS, timeout=60)
        resp.raise_for_status()
        payload = resp.json()
        cache.put(url, payload)

    if not payload.get("data"):
        raise ValueError(f"No NAV data for scheme {scheme_code}")

    df = pd.DataFrame(payload["data"])
    df["date"] = pd.to_datetime(df["date"], format="%d-%m-%Y")
    df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
    df = df.dropna(subset=["nav"]).sort_values("date").set_index("date")
    df.attrs["meta"] = payload.get("meta", {})
    return df[["nav"]]
