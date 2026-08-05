"""Return and risk metrics for a NAV / price series."""

from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252
PERIODS = {"1m": 30, "3m": 91, "6m": 182, "1y": 365, "3y": 1095, "5y": 1825, "10y": 3650}


def _as_series(data: pd.Series | pd.DataFrame, column: str | None = None) -> pd.Series:
    if isinstance(data, pd.DataFrame):
        col = column or ("nav" if "nav" in data else "adj_close" if "adj_close" in data else data.columns[-1])
        data = data[col]
    s = data.dropna().sort_index()
    # Public NAV feeds occasionally carry 0.0 placeholder rows, which otherwise
    # produce a fake -100% drawdown and blow up log returns.
    return s[s > 0]


def _periods_per_year(s: pd.Series) -> float:
    """Infer sampling frequency from the index instead of assuming daily bars.

    Yahoo silently downgrades long ranges to weekly/monthly candles, so a hard-coded
    sqrt(252) would badly overstate volatility on those series.
    """
    if len(s) < 3:
        return float(TRADING_DAYS)
    gap = float(pd.Series(s.index).diff().dt.days.median())
    if not np.isfinite(gap) or gap <= 0:
        return float(TRADING_DAYS)
    if gap <= 4:  # daily bars, with weekends/holidays removed
        return float(TRADING_DAYS)
    return 365.25 / gap


def cagr(series: pd.Series | pd.DataFrame, column: str | None = None) -> float:
    """Annualised growth rate over the full span of the series."""
    s = _as_series(series, column)
    if len(s) < 2:
        return float("nan")
    years = (s.index[-1] - s.index[0]).days / 365.25
    if years <= 0 or s.iloc[0] <= 0:
        return float("nan")
    return (s.iloc[-1] / s.iloc[0]) ** (1 / years) - 1


def trailing_returns(series: pd.Series | pd.DataFrame, column: str | None = None) -> pd.Series:
    """Point-to-point returns; annualised for periods >= 1 year."""
    s = _as_series(series, column)
    if s.empty:
        return pd.Series(dtype=float)

    end_date, end_val = s.index[-1], s.iloc[-1]
    out: dict[str, float] = {}
    for label, days in PERIODS.items():
        start_target = end_date - pd.Timedelta(days=days)
        if s.index[0] > start_target:
            continue
        pos = s.index.searchsorted(start_target, side="left")
        pos = min(pos, len(s) - 1)
        start_val = s.iloc[pos]
        if start_val <= 0:
            continue
        total = end_val / start_val
        years = days / 365.25
        out[label] = total ** (1 / years) - 1 if years >= 1 else total - 1
    return pd.Series(out, name="return")


def volatility(series: pd.Series | pd.DataFrame, column: str | None = None) -> float:
    """Annualised standard deviation of log returns, scaled to the series' own frequency."""
    s = _as_series(series, column)
    if len(s) < 3:
        return float("nan")
    return float(np.log(s / s.shift(1)).dropna().std() * np.sqrt(_periods_per_year(s)))


def max_drawdown(series: pd.Series | pd.DataFrame, column: str | None = None) -> dict:
    """Worst peak-to-trough decline, with dates and recovery status."""
    s = _as_series(series, column)
    if s.empty:
        return {"max_drawdown": float("nan"), "peak_date": None, "trough_date": None, "recovered": None}

    running_max = s.cummax()
    dd = s / running_max - 1
    trough_date = dd.idxmin()
    peak_date = s.loc[:trough_date].idxmax()
    after = s.loc[trough_date:]
    recovery = after[after >= s.loc[peak_date]]
    return {
        "max_drawdown": float(dd.min()),
        "peak_date": peak_date,
        "trough_date": trough_date,
        "recovered": None if recovery.empty else recovery.index[0],
    }


def sharpe(series: pd.Series | pd.DataFrame, risk_free: float = 0.065, column: str | None = None) -> float:
    """Sharpe ratio. Default risk-free ~6.5% reflects Indian short-term govt yields."""
    vol = volatility(series, column)
    if not np.isfinite(vol) or vol == 0:
        return float("nan")
    return (cagr(series, column) - risk_free) / vol


def rolling_returns(
    series: pd.Series | pd.DataFrame, years: int = 3, column: str | None = None
) -> pd.Series:
    """Annualised return for every rolling N-year window. The honest way to judge a fund."""
    s = _as_series(series, column)
    window = pd.Timedelta(days=int(round(years * 365.25)))
    if s.empty or (s.index[-1] - s.index[0]) < window:
        return pd.Series(dtype=float)

    start_positions = s.index.searchsorted(s.index - window, side="left")
    out: dict = {}
    for i, start_pos in enumerate(start_positions):
        if s.index[start_pos] > s.index[i] - window:
            continue
        start_val = s.iloc[start_pos]
        if start_val <= 0:
            continue
        out[s.index[i]] = (s.iloc[i] / start_val) ** (1 / years) - 1
    return pd.Series(out, name=f"{years}y_rolling").sort_index()


def summary(
    series: pd.Series | pd.DataFrame, risk_free: float = 0.065, column: str | None = None
) -> dict:
    """One-shot risk/return profile."""
    s = _as_series(series, column)
    dd = max_drawdown(s)
    roll3 = rolling_returns(s, 3)
    ppy = _periods_per_year(s) if not s.empty else float("nan")
    return {
        "start": None if s.empty else s.index[0].date(),
        "end": None if s.empty else s.index[-1].date(),
        "points": len(s),
        "sampling": "daily" if ppy > 100 else "weekly" if ppy > 30 else "monthly" if ppy > 6 else "sparse",
        "cagr": cagr(s),
        "volatility": volatility(s),
        "sharpe": sharpe(s, risk_free),
        "max_drawdown": dd["max_drawdown"],
        "max_dd_trough": None if dd["trough_date"] is None else dd["trough_date"].date(),
        "recovered": dd["recovered"].date() if isinstance(dd["recovered"], pd.Timestamp) else None,
        "roll3y_median": float(roll3.median()) if not roll3.empty else float("nan"),
        "roll3y_worst": float(roll3.min()) if not roll3.empty else float("nan"),
        "roll3y_pct_negative": float((roll3 < 0).mean()) if not roll3.empty else float("nan"),
    }
