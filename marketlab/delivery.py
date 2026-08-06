"""NSE delivery/participation layer from the legacy daily bhavdata file."""

from __future__ import annotations

import datetime as dt
import io
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "delivery"
URL = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{d:%d%m%Y}.csv"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Accept": "text/csv,text/plain,*/*",
    "Referer": "https://www.nseindia.com/",
}

OUT_COLUMNS = [
    "delivery_pct_latest",
    "delivery_pct_median_20d",
    "delivery_value_median_20d",
    "delivery_spike",
    "high_delivery_days_20d",
    "delivery_source_date",
]


def _cache_path(d: dt.date) -> Path:
    return RAW / f"{d:%Y%m%d}.pkl"


def day(d: dt.date, timeout: int = 25) -> pd.DataFrame | None:
    p = _cache_path(d)
    if p.exists():
        return pd.read_pickle(p)
    r = requests.get(URL.format(d=d), headers=HEADERS, timeout=timeout)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    if "<html" in r.text[:300].lower():
        return None
    df = pd.read_csv(io.StringIO(r.text), skipinitialspace=True)
    df.columns = [c.strip().lower() for c in df.columns]
    if "symbol" not in df or "series" not in df:
        return None
    df = df[df["series"].astype(str).str.strip().eq("EQ")].copy()
    df["symbol"] = df["symbol"].astype(str).str.upper().str.strip()
    df["date"] = pd.Timestamp(d)
    numeric = ["ttl_trd_qnty", "turnover_lacs", "no_of_trades", "deliv_qty", "deliv_per", "close_price"]
    for c in numeric:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    if "turnover_lacs" in df:
        df["turnover"] = df["turnover_lacs"] * 100_000
    if "deliv_qty" in df and "close_price" in df:
        df["delivery_value"] = df["deliv_qty"] * df["close_price"]
    RAW.mkdir(parents=True, exist_ok=True)
    df.to_pickle(p)
    return df


def fetch_recent(end: dt.date, sessions: int = 20, max_back: int = 45) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    d = end
    checked = 0
    while checked < max_back and len(frames) < sessions:
        if d.weekday() < 5:
            try:
                df = day(d)
            except (requests.RequestException, ValueError, OSError):
                df = None
            if df is not None and not df.empty:
                frames.append(df)
        d -= dt.timedelta(days=1)
        checked += 1
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _empty(symbols: pd.Index) -> pd.DataFrame:
    out = pd.DataFrame(index=pd.Index([str(s).upper() for s in symbols], name="symbol"))
    for c in OUT_COLUMNS:
        out[c] = pd.NaT if c == "delivery_source_date" else 0.0
    return out


def summarize(symbols: pd.Index, raw: pd.DataFrame) -> pd.DataFrame:
    out = _empty(symbols)
    if raw.empty:
        return out
    idx = out.index
    d = raw[raw["symbol"].isin(idx)].copy()
    if d.empty:
        return out
    grouped = d.groupby("symbol", sort=False)
    med_pct = grouped["deliv_per"].median()
    med_value = grouped["delivery_value"].median()
    high_days = grouped["deliv_per"].apply(lambda s: int((s >= 60).sum()))
    out.loc[med_pct.index, "delivery_pct_median_20d"] = med_pct
    out.loc[med_value.index, "delivery_value_median_20d"] = med_value
    out.loc[high_days.index, "high_delivery_days_20d"] = high_days

    latest = d.sort_values("date").groupby("symbol").tail(1).set_index("symbol")
    out.loc[latest.index, "delivery_pct_latest"] = latest["deliv_per"]
    out.loc[latest.index, "delivery_source_date"] = latest["date"]
    baseline = out["delivery_pct_median_20d"].replace(0, pd.NA)
    out["delivery_spike"] = (out["delivery_pct_latest"] / baseline).astype(float)
    return out


def fetch_and_summarize(symbols: pd.Index, end: dt.date) -> tuple[pd.DataFrame, dict]:
    raw = fetch_recent(end=end)
    if raw.empty:
        return _empty(symbols), {
            "delivery_source": "NSE sec_bhavdata_full",
            "delivery_status": "unavailable",
            "delivery_rows": 0,
            "delivery_symbols": 0,
            "delivery_window_sessions": 20,
        }
    summary = summarize(symbols, raw)
    DATA.mkdir(parents=True, exist_ok=True)
    summary.to_pickle(DATA / "delivery_summary.pkl")
    return summary, {
        "delivery_source": "NSE sec_bhavdata_full",
        "delivery_status": "ok",
        "delivery_rows": int(len(raw)),
        "delivery_symbols": int(summary["delivery_pct_median_20d"].gt(0).sum()),
        "delivery_window_sessions": int(raw["date"].nunique()),
    }
