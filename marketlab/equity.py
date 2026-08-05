"""Indian equity / index price history via Yahoo Finance chart API.

Suffixes: NSE = '.NS' (e.g. RELIANCE.NS), BSE = '.BO'.
Indices: ^NSEI (Nifty 50), ^NSEBANK (Bank Nifty), ^BSESN (Sensex).

This is delayed, best-effort data intended for research and backtesting.
Do not use it as an execution feed.
"""

from __future__ import annotations

import pandas as pd
import requests

from . import cache

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

INDICES = {
    "nifty50": "^NSEI",
    "banknifty": "^NSEBANK",
    "sensex": "^BSESN",
    "niftymidcap150": "^CRSMID",
}


def _fetch(symbol: str, range_: str, interval: str, max_age_s: float) -> dict:
    url = CHART.format(symbol=symbol)
    key = f"{url}?range={range_}&interval={interval}"
    payload = cache.get(key, max_age_s)
    if payload is not None:
        return payload
    resp = requests.get(
        url,
        params={"range": range_, "interval": interval, "events": "div,split"},
        headers=_HEADERS,
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json()
    cache.put(key, payload)
    return payload


def history(
    symbol: str,
    range_: str = "5y",
    interval: str = "1d",
    max_age_s: float = 6 * 3600,
) -> pd.DataFrame:
    """OHLCV history. Returns DatetimeIndex (IST date) with open/high/low/close/adj_close/volume."""
    symbol = INDICES.get(symbol.lower(), symbol)
    payload = _fetch(symbol, range_, interval, max_age_s)

    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise ValueError(f"{symbol}: {chart['error'].get('description', chart['error'])}")
    results = chart.get("result") or []
    if not results:
        raise ValueError(f"No data returned for {symbol}")

    res = results[0]
    ts = res.get("timestamp")
    if not ts:
        raise ValueError(f"No price points for {symbol} (range={range_}, interval={interval})")

    quote = res["indicators"]["quote"][0]
    df = pd.DataFrame(
        {
            "open": quote.get("open"),
            "high": quote.get("high"),
            "low": quote.get("low"),
            "close": quote.get("close"),
            "volume": quote.get("volume"),
        },
        index=pd.to_datetime(ts, unit="s", utc=True).tz_convert("Asia/Kolkata"),
    )

    adj = (res.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose")
    df["adj_close"] = adj if adj is not None else df["close"]

    if interval.endswith(("d", "wk", "mo")):
        df.index = df.index.normalize().tz_localize(None)
    df.index.name = "date"

    df = df.dropna(subset=["close"])
    df.attrs["meta"] = res.get("meta", {})
    return df[["open", "high", "low", "close", "adj_close", "volume"]]


def quote(symbol: str) -> dict:
    """Latest available price snapshot (delayed)."""
    symbol = INDICES.get(symbol.lower(), symbol)
    payload = _fetch(symbol, "5d", "1d", max_age_s=300)
    meta = payload["chart"]["result"][0]["meta"]
    return {
        "symbol": meta.get("symbol"),
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName"),
        "price": meta.get("regularMarketPrice"),
        "previous_close": meta.get("chartPreviousClose") or meta.get("previousClose"),
        "day_high": meta.get("regularMarketDayHigh"),
        "day_low": meta.get("regularMarketDayLow"),
        "fifty_two_week_high": meta.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": meta.get("fiftyTwoWeekLow"),
        "time": pd.to_datetime(meta.get("regularMarketTime"), unit="s", utc=True).tz_convert(
            "Asia/Kolkata"
        )
        if meta.get("regularMarketTime")
        else None,
    }
