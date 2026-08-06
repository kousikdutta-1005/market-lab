"""NSE Bhavcopy — the whole cash market, one file per trading day.

WHY THIS EXISTS
The first version of this tool pulled prices from Yahoo, one HTTP request per stock.
At 200 stocks that is merely slow. At 2,078 it is antisocial, and Yahoo responded the
way any sane operator would: it rate-limited the IP across every endpoint and host.

The exchange publishes the same information far better. One bhavcopy file contains the
full day's OHLC, volume, turnover and trade count for every listed security. So the whole
market costs one request per *day* rather than one per *stock* — roughly 250 requests for
a year of history instead of 2,078 for a single snapshot.

It is also better data:
  * authoritative — this is the exchange's own settlement record, not a reconstruction
  * TtlTrfVal is real rupee turnover, not an estimate of price x volume
  * TtlNbOfTxsExctd (trade count) exposes thin trading that volume alone can hide
  * historical files are immutable, so they cache permanently and never need refetching

Coverage note: the UDiFF format used here begins in 2024. Older history needs the legacy
`sec_bhavdata_full` file, which is not implemented — two years is sufficient for liquidity
screening and 12-month momentum, which is all this module is asked for.
"""

from __future__ import annotations

import datetime as dt
import io
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import requests

from . import cache

DATA = Path(__file__).resolve().parent.parent / "data"
RAW = DATA / "bhavcopy"

URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d:%Y%m%d}_F_0000.csv.zip"

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Referer": "https://www.nseindia.com/",
}

# Equity series only. SM/ST are the SME platform, BE/BZ are surveillance segments.
EQUITY_SERIES = {"EQ"}

_COLS = {
    "TckrSymb": "symbol",
    "SctySrs": "series",
    "OpnPric": "open",
    "HghPric": "high",
    "LwPric": "low",
    "ClsPric": "close",
    "PrvsClsgPric": "prev_close",
    "TtlTradgVol": "volume",
    "TtlTrfVal": "turnover",
    "TtlNbOfTxsExctd": "trades",
    "ISIN": "isin",
}

_lock = threading.Lock()


def _cache_path(d: dt.date) -> Path:
    return RAW / f"{d:%Y%m%d}.parquet"


def day(d: dt.date, session: requests.Session | None = None) -> pd.DataFrame | None:
    """One trading day for the whole market. None if the market was closed.

    Cached to parquet. Historical bhavcopies never change, so a cache hit is final.
    """
    p = _cache_path(d)
    if p.exists():
        try:
            return pd.read_parquet(p)
        except Exception:
            p.unlink(missing_ok=True)

    get = (session or requests).get
    r = get(URL.format(d=d), headers=UA, timeout=60)
    if r.status_code == 404:
        return None  # weekend or exchange holiday
    r.raise_for_status()
    if r.content[:2] != b"PK":
        return None

    z = zipfile.ZipFile(io.BytesIO(r.content))
    df = pd.read_csv(z.open(z.namelist()[0]))
    df = df[df["SctySrs"].astype(str).str.strip().isin(EQUITY_SERIES)]
    df = df[[c for c in _COLS if c in df.columns]].rename(columns=_COLS)
    df["symbol"] = df["symbol"].astype(str).str.strip()
    df["date"] = pd.Timestamp(d)

    with _lock:
        RAW.mkdir(parents=True, exist_ok=True)
        try:
            df.to_parquet(p, index=False)
        except Exception:
            pass  # cache write failure must not fail the fetch
    return df


def trading_days(start: dt.date, end: dt.date) -> list[dt.date]:
    """Weekdays in range. Exchange holidays are discovered as 404s, not predicted."""
    days, d = [], start
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += dt.timedelta(days=1)
    return days


def fetch_range(
    start: dt.date,
    end: dt.date,
    workers: int = 6,
    progress=None,
    on_log=None,
) -> pd.DataFrame:
    """Every trading day between start and end, concatenated long-form."""
    days = trading_days(start, end)
    frames: list[pd.DataFrame] = []
    holidays = 0

    session = requests.Session()
    session.headers.update(UA)

    def work(d: dt.date):
        try:
            return d, day(d, session=session)
        except Exception:
            return d, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, d) for d in days]
        for i, fut in enumerate(as_completed(futures), 1):
            _, df = fut.result()
            if df is None or df.empty:
                holidays += 1
            else:
                frames.append(df)
            if progress:
                progress.tick(df is not None)
            if on_log and i % 50 == 0:
                on_log(f"  {i}/{len(days)} days ({len(frames)} sessions)")

    if on_log:
        on_log(f"  {len(frames)} trading sessions, {holidays} non-trading days")
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True).sort_values(["date", "symbol"])


def matrices(long: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Pivot long-form bhavcopy into date x symbol matrices."""
    out = {}
    for field in ("close", "open", "high", "low", "volume", "turnover", "trades"):
        if field in long.columns:
            out[field] = long.pivot_table(
                index="date", columns="symbol", values=field, aggfunc="last"
            ).sort_index()
    return out


def save(mats: dict[str, pd.DataFrame], prefix: str = "nse") -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for name, df in mats.items():
        df.to_pickle(DATA / f"{prefix}_{name}.pkl")


def load(prefix: str = "nse", fields=("close", "volume", "turnover", "trades")) -> dict:
    out = {}
    for f in fields:
        p = DATA / f"{prefix}_{f}.pkl"
        if p.exists():
            out[f] = pd.read_pickle(p)
    return out


def latest_available(max_back: int = 10) -> dt.date | None:
    """Most recent date with a published bhavcopy."""
    session = requests.Session()
    session.headers.update(UA)
    today = dt.date.today()
    for back in range(0, max_back):
        d = today - dt.timedelta(days=back)
        if d.weekday() >= 5:
            continue
        try:
            if day(d, session=session) is not None:
                return d
        except Exception:
            continue
    return None
