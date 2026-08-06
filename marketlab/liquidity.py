"""Is a stock actually tradeable? The gate that makes a wide universe meaningful.

Widening from 200 to 2,078 stocks mostly adds stocks you cannot buy. This module
decides which ones are real, and it exists because of a specific failure mode:

    ILLIQUID STOCKS LOOK GOOD TO A SCREENER.

A stock that barely trades has a *stale* price. Stale prices produce artificially low
measured volatility, artificially smooth trends, and — because the last print may be days
old — stale valuation ratios. Momentum and risk-adjusted metrics are computed by dividing
by volatility, so understated volatility inflates exactly the scores we rank on. Left
ungated, the tail of the market floats to the top of the table for purely mechanical
reasons, and the screen becomes an illiquidity detector wearing a quality costume.

The gates:
  turnover      median daily traded value over the window (price x volume)
  zero_vol_pct  share of sessions with no trades at all
  stale_pct     share of sessions where close did not move at all
  max_stale_run longest consecutive run of unchanged closes
  price         a floor, since sub-rupee stocks move in tick-size jumps
  history       enough sessions to measure anything

Thresholds scale with size bucket: a nano-cap is never going to trade like a large cap,
so a single absolute cut would simply delete the entire small end. What does not scale is
the *stale price* test, which is about data validity rather than size.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Median daily traded value required, in INR, by size bucket.
# A position you cannot exit within a few days at a sane price is not an investment.
MIN_TURNOVER = {
    "large": 5_00_00_000,   # Rs 5 cr
    "mid": 2_00_00_000,     # Rs 2 cr
    "small": 50_00_000,     # Rs 50 lakh
    "micro": 20_00_000,     # Rs 20 lakh
    "nano": 10_00_000,      # Rs 10 lakh
}

MIN_PRICE = 5.0            # rupees
MIN_SESSIONS = 200         # roughly one trading year
MAX_ZERO_VOL_PCT = 10.0    # % of sessions with zero volume
MAX_STALE_PCT = 25.0       # % of sessions with an unchanged close
MAX_STALE_RUN = 10         # consecutive unchanged closes

WINDOW = 250               # sessions used to measure liquidity


def _longest_run(mask: pd.Series) -> int:
    if mask.empty or not mask.any():
        return 0
    grp = (~mask).cumsum()
    return int(mask.groupby(grp).sum().max())


def measure(
    close: pd.Series,
    volume: pd.Series,
    window: int = WINDOW,
    turnover: pd.Series | None = None,
    trades: pd.Series | None = None,
) -> dict:
    """Liquidity and price-staleness statistics for one stock.

    `turnover` and `trades` come straight from the exchange bhavcopy when available.
    Falling back to price x volume is an approximation: it ignores that the day's trades
    happened at many prices, so it misstates turnover on volatile days.
    """
    close = pd.to_numeric(close, errors="coerce")
    volume = pd.to_numeric(volume, errors="coerce")
    cols = {"close": close, "volume": volume}
    if turnover is not None:
        cols["turnover"] = pd.to_numeric(turnover, errors="coerce")
    if trades is not None:
        cols["trades"] = pd.to_numeric(trades, errors="coerce")
    df = pd.DataFrame(cols).dropna(subset=["close"])
    df = df[df["close"] > 0]

    out = {
        "sessions": int(len(df)),
        "turnover_median": np.nan,
        "turnover_p10": np.nan,
        "trades_median": np.nan,
        "last_price": np.nan,
        "zero_vol_pct": np.nan,
        "stale_pct": np.nan,
        "max_stale_run": np.nan,
    }
    if df.empty:
        return out

    out["last_price"] = float(df["close"].iloc[-1])
    recent = df.tail(window)
    if recent.empty:
        return out

    vol = recent["volume"].fillna(0)
    tv = recent["turnover"] if "turnover" in recent else recent["close"] * vol
    tv = tv.fillna(0)
    out["turnover_median"] = float(tv.median())
    out["turnover_p10"] = float(tv.quantile(0.10))
    if "trades" in recent:
        out["trades_median"] = float(recent["trades"].fillna(0).median())
    out["zero_vol_pct"] = float((vol <= 0).mean() * 100)

    # An unchanged close on a liquid stock is rare; on a dead one it is the norm.
    unchanged = recent["close"].diff() == 0
    out["stale_pct"] = float(unchanged.mean() * 100)
    out["max_stale_run"] = _longest_run(unchanged)
    return out


def screen(stats: pd.DataFrame, buckets: pd.Series) -> pd.DataFrame:
    """Apply the gates. Returns the input plus `tradeable`, `scoreable` and reason lists.

    TWO SEPARATE QUESTIONS, DELIBERATELY NOT MERGED:

      tradeable  — can you actually buy and sell this at a sane price?
      scoreable  — is there enough history to compute the metrics we rank on?

    An earlier version merged them, and it silently discarded Groww, LG Electronics
    India and the demerged Tata Motors entities — stocks turning over hundreds of crores
    a day — purely because they listed recently. That is a wrong answer to "is this
    tradeable", and hiding a Rs 500 crore/day stock behind a liquidity label would have
    been invisible in the UI. A recent IPO is fully tradeable and simply cannot yet be
    ranked on 12-month momentum; the interface should say exactly that.

    Reason lists carry every failure, not just the first, so a rejection is auditable.
    """
    s = stats.copy()
    b = buckets.reindex(s.index).fillna("nano")
    min_turnover = b.map(MIN_TURNOVER).astype(float).fillna(MIN_TURNOVER["nano"])
    s["min_turnover_required"] = min_turnover

    liquidity_checks = {
        "thin turnover": s["turnover_median"] < min_turnover,
        "penny price": s["last_price"] < MIN_PRICE,
        "zero-volume days": s["zero_vol_pct"] > MAX_ZERO_VOL_PCT,
        "stale price": s["stale_pct"] > MAX_STALE_PCT,
        "frozen price run": s["max_stale_run"] > MAX_STALE_RUN,
    }
    history_checks = {
        "no data": s["sessions"] == 0,
        "short history": s["sessions"] < MIN_SESSIONS,
    }

    def collect(checks: dict) -> pd.Series:
        reasons = pd.Series([[] for _ in range(len(s))], index=s.index, dtype="object")
        for label, failed in checks.items():
            failed = failed.astype("boolean").fillna(True).astype(bool)
            for idx in s.index[failed]:
                reasons.at[idx] = reasons.at[idx] + [label]
        return reasons

    s["liquidity_reject"] = collect(liquidity_checks)
    s["history_reject"] = collect(history_checks)
    s["tradeable"] = s["liquidity_reject"].map(len) == 0
    s["scoreable"] = s["tradeable"] & (s["history_reject"].map(len) == 0)
    return s


def report(screened: pd.DataFrame) -> pd.DataFrame:
    """Why the universe shrank, as a count per reason."""
    from collections import Counter

    c: Counter = Counter()
    for col in ("liquidity_reject", "history_reject"):
        if col in screened:
            for reasons in screened[col]:
                for r in reasons:
                    c[r] += 1
    return (
        pd.DataFrame({"stocks_failing": pd.Series(c)})
        .sort_values("stocks_failing", ascending=False)
        .rename_axis("reason")
    )
