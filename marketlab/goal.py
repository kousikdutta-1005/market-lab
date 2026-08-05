"""Feasibility analysis: convert a target multiple + horizon into required CAGR,
then check that requirement against real historical base rates.

The point of this module is to answer "how much will I make?" honestly — as a
distribution of historical outcomes, not a single confident number.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .metrics import _as_series


def required_cagr(multiple: float, years: float) -> float:
    """CAGR needed to grow 1 unit into `multiple` units over `years`."""
    if multiple <= 0 or years <= 0:
        raise ValueError("multiple and years must be positive")
    return multiple ** (1 / years) - 1


def horizon_for(multiple: float, cagr: float) -> float:
    """Years needed to reach `multiple` at a given CAGR."""
    if multiple <= 0:
        raise ValueError("multiple must be positive")
    if cagr <= -1:
        raise ValueError("cagr must be > -100%")
    if cagr == 0:
        return float("inf")
    return float(np.log(multiple) / np.log(1 + cagr))


def window_returns(
    series: pd.Series | pd.DataFrame, years: float, column: str | None = None
) -> pd.Series:
    """Annualised return for every rolling window of `years` length.

    Index is the window END date; values are annualised returns.
    """
    s = _as_series(series, column)
    window = pd.Timedelta(days=int(round(years * 365.25)))
    if s.empty or (s.index[-1] - s.index[0]) < window:
        return pd.Series(dtype=float)

    starts = s.index.searchsorted(s.index - window, side="left")
    out: dict = {}
    for i, sp in enumerate(starts):
        if s.index[sp] > s.index[i] - window:
            continue
        start_val = s.iloc[sp]
        if start_val <= 0:
            continue
        out[s.index[i]] = (s.iloc[i] / start_val) ** (1 / years) - 1
    return pd.Series(out, name=f"{years}y").sort_index()


def independent_windows(series: pd.Series | pd.DataFrame, years: float) -> float:
    """How many NON-overlapping windows the history actually contains.

    Rolling windows are heavily autocorrelated: 4,000 overlapping 10-year windows
    drawn from 19 years of data are not 4,000 pieces of evidence. This is the
    number that should govern how much you trust a probability estimate.
    """
    s = _as_series(series)
    if s.empty:
        return 0.0
    span_years = (s.index[-1] - s.index[0]).days / 365.25
    return span_years / years if years > 0 else 0.0


def feasibility(
    series: pd.Series | pd.DataFrame,
    multiple: float,
    years: float,
    column: str | None = None,
) -> dict:
    """Historical base rate for hitting `multiple` within `years`."""
    need = required_cagr(multiple, years)
    wins = window_returns(series, years, column)
    indep = independent_windows(series, years)

    if wins.empty:
        return {
            "multiple": multiple,
            "years": years,
            "required_cagr": need,
            "n_windows": 0,
            "independent_windows": indep,
            "hit_rate": float("nan"),
            "note": "history shorter than the requested horizon",
        }

    return {
        "multiple": multiple,
        "years": years,
        "required_cagr": need,
        "n_windows": int(len(wins)),
        "independent_windows": indep,
        "hit_rate": float((wins >= need).mean()),
        "best": float(wins.max()),
        "median": float(wins.median()),
        "worst": float(wins.min()),
        "p10": float(wins.quantile(0.10)),
        "p90": float(wins.quantile(0.90)),
        "best_window_end": wins.idxmax(),
        "worst_window_end": wins.idxmin(),
    }


def fastest_multiple(
    series: pd.Series | pd.DataFrame, multiple: float, column: str | None = None
) -> dict:
    """The shortest time this series EVER took to grow by `multiple`.

    This is a best case chosen with perfect hindsight — you would have had to buy
    at the exact bottom. Treat it as an upper bound on what was possible, not a
    plan. Nobody achieves it prospectively.
    """
    s = _as_series(series, column)
    if s.empty:
        return {"achieved": False}

    values = s.to_numpy()
    n = len(values)
    best_days = None
    best_pair = None

    # For each start, find the earliest later point reaching multiple * start.
    # Running max of the suffix lets us skip starts that can never qualify.
    suffix_max = np.maximum.accumulate(values[::-1])[::-1]

    for i in range(n - 1):
        target = values[i] * multiple
        if suffix_max[i] < target:
            continue
        j = i + int(np.argmax(values[i:] >= target))
        if values[j] < target:
            continue
        days = (s.index[j] - s.index[i]).days
        if best_days is None or days < best_days:
            best_days, best_pair = days, (s.index[i], s.index[j])

    if best_days is None:
        return {"achieved": False, "multiple": multiple}

    years = best_days / 365.25
    return {
        "achieved": True,
        "multiple": multiple,
        "days": best_days,
        "years": years,
        "cagr": multiple ** (1 / years) - 1 if years > 0 else float("inf"),
        "from": best_pair[0].date(),
        "to": best_pair[1].date(),
    }


def real_terms(nominal_multiple: float, years: float, inflation: float = 0.055) -> float:
    """What `nominal_multiple` is worth in today's purchasing power.

    Indian CPI has averaged roughly 5-6% over the long run. A 10x nominal gain
    over 20 years is a much less exciting number after inflation.
    """
    return nominal_multiple / ((1 + inflation) ** years)
