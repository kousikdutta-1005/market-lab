"""Replication of NSE's published Nifty200 Momentum 30 methodology.

Source: NSE Indices factor index methodology (Nifty200 Momentum 30 / Nifty500 Momentum 50).

The rules, verbatim in effect:
  1. Universe: Nifty 200 members, >= 1 year listing history, available in F&O.
  2. For each stock compute 6m and 12m price returns.
  3. Divide each by the ANNUALISED standard deviation of LOGNORMAL DAILY returns
     over the past one year. NSE does NOT subtract a risk-free rate.
  4. Convert each ratio to a cross-sectional z-score across eligible stocks.
  5. Average the two z-scores -> Weighted Average Z-Score (WAZS).
  6. Normalised Momentum Score: (1 + z) if z >= 0 else 1 / (1 - z).
  7. Take the top 30 by score.
  8. Weight by free-float market cap x normalised momentum score, cap each at 5%.
  9. Rebalance semi-annually (June and December).

WHY THIS AND NOT STOCK TIPS: every selection here is reproducible from public
prices. You can audit exactly why any stock appears. That is the opposite of a
"multibagger recommendation", which you cannot verify and cannot backtest.

WHAT THIS IS NOT: a prediction. NSE's own index underperformed the Nifty 50 for
roughly three years (Jan 2017 - Mar 2020) and again during the Mar 2020 recovery.
Two investors entering two months apart (Mar vs May 2021) got 18.3% vs 3.4%.
Same rules, same index, wildly different outcome. Entry timing dominates.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def annualised_vol(daily_px: pd.DataFrame, asof: pd.Timestamp, days: int = TRADING_DAYS) -> pd.Series:
    """Annualised SD of lognormal daily returns over the trailing year."""
    window = daily_px.loc[:asof].tail(days + 1)
    if len(window) < days // 2:
        return pd.Series(np.nan, index=daily_px.columns)
    logret = np.log(window / window.shift(1)).iloc[1:]
    return logret.std() * np.sqrt(TRADING_DAYS)


def _return_over(daily_px: pd.DataFrame, asof: pd.Timestamp, months: int) -> pd.Series:
    hist = daily_px.loc[:asof]
    if hist.empty:
        return pd.Series(np.nan, index=daily_px.columns)
    start = asof - pd.DateOffset(months=months)
    prior = hist.loc[:start]
    if prior.empty:
        return pd.Series(np.nan, index=daily_px.columns)
    return hist.iloc[-1] / prior.iloc[-1] - 1


def normalised_momentum_score(
    daily_px: pd.DataFrame, asof: pd.Timestamp, min_history_days: int = 252
) -> pd.DataFrame:
    """Full NSE momentum score table for one date, highest score first."""
    hist = daily_px.loc[:asof]
    eligible = hist.columns[hist.notna().sum() >= min_history_days]
    if len(eligible) < 10:
        raise ValueError(f"only {len(eligible)} stocks have >= 1y history at {asof.date()}")

    px = daily_px[eligible]
    sd = annualised_vol(px, asof)
    r6, r12 = _return_over(px, asof, 6), _return_over(px, asof, 12)

    df = pd.DataFrame({"ret_6m": r6, "ret_12m": r12, "ann_vol": sd}).dropna()
    df = df[df["ann_vol"] > 0]

    df["mr_6m"] = df["ret_6m"] / df["ann_vol"]
    df["mr_12m"] = df["ret_12m"] / df["ann_vol"]

    for col in ("mr_6m", "mr_12m"):
        std = df[col].std()
        df[f"z_{col[3:]}"] = 0.0 if std == 0 else (df[col] - df[col].mean()) / std

    df["wazs"] = df[["z_6m", "z_12m"]].mean(axis=1)
    df["nms"] = np.where(df["wazs"] >= 0, 1 + df["wazs"], 1 / (1 - df["wazs"]))
    return df.sort_values("nms", ascending=False)


def select(
    daily_px: pd.DataFrame,
    asof: pd.Timestamp,
    n: int = 30,
    free_float_mcap: pd.Series | None = None,
    cap: float = 0.05,
) -> pd.DataFrame:
    """Top-N constituents with NSE-style capped weights.

    Without free-float market caps, falls back to score-proportional weighting.
    That is a documented deviation from the official index, not the real thing.
    """
    scored = normalised_momentum_score(daily_px, asof).head(n).copy()

    if free_float_mcap is not None:
        ff = free_float_mcap.reindex(scored.index).fillna(0.0)
        raw = ff * scored["nms"]
        scored.attrs["weighting"] = "free-float mcap x NMS (official)"
    else:
        raw = scored["nms"]
        scored.attrs["weighting"] = "NMS only (APPROXIMATION - no free-float data)"

    w = raw / raw.sum() if raw.sum() > 0 else pd.Series(1 / len(scored), index=scored.index)

    # Iteratively enforce the 5% cap, redistributing excess to uncapped names.
    for _ in range(100):
        over = w > cap + 1e-12
        if not over.any():
            break
        excess = (w[over] - cap).sum()
        w[over] = cap
        room = ~over
        if not room.any() or w[room].sum() == 0:
            break
        w[room] += excess * w[room] / w[room].sum()

    scored["weight"] = w
    return scored


def rebalance_dates(index: pd.DatetimeIndex, months=(6, 12)) -> list[pd.Timestamp]:
    """Last available trading day in each rebalance month (NSE uses June/December)."""
    s = pd.Series(index, index=index)
    return [g.iloc[-1] for _, g in s.groupby([index.year, index.month]) if _[1] in months]
