"""Cross-sectional backtest: does buying beaten-down Indian stocks actually work?

Compares three rules on the same universe, same dates, same costs:
  * reversal  — buy the WORST trailing performers ("beaten down, will recover")
  * momentum  — buy the BEST trailing performers
  * equal-wt  — hold the whole universe (the honest baseline)

KNOWN BIAS, STATED UP FRONT: the universe is TODAY's Nifty 200. Companies that
collapsed and fell out of the index are missing. That biases results in favour of
the reversal rule, because its worst picks — the ones that never came back — have
been deleted from history. Real-world reversal returns would be worse than shown.
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd

from . import equity

DATA = Path(__file__).resolve().parent.parent / "data"


def load_universe(csv_path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df["ticker"] = df["symbol"].str.strip() + ".NS"
    return df[["company_name", "industry", "symbol", "ticker"]]


def fetch_prices(
    tickers: list[str], range_: str = "20y", pause: float = 0.35, verbose: bool = True
) -> pd.DataFrame:
    """Monthly close prices, one column per ticker. Cached, so re-runs are cheap."""
    series: dict[str, pd.Series] = {}
    failed: list[str] = []
    for i, t in enumerate(tickers, 1):
        try:
            h = equity.history(t, range_=range_, interval="1mo", max_age_s=7 * 86400)
            series[t] = h["adj_close"]
        except Exception:
            failed.append(t)
        else:
            time.sleep(pause)
        if verbose and i % 25 == 0:
            print(f"  fetched {i}/{len(tickers)} ({len(failed)} failed)", flush=True)

    if verbose and failed:
        print(f"  no data for {len(failed)}: {', '.join(failed[:8])}{'...' if len(failed) > 8 else ''}")
    px = pd.DataFrame(series).sort_index()
    px.index = pd.to_datetime(px.index).tz_localize(None).normalize()
    return px


def backtest(
    prices: pd.DataFrame,
    lookback_m: int = 12,
    hold_m: int = 12,
    n_pick: int = 20,
    cost_bps: float = 60.0,
) -> pd.DataFrame:
    """Run all three rules. Returns one row per rebalance with each rule's forward return.

    cost_bps covers brokerage + STT + exchange fees + slippage on a full round trip.
    60bps is a deliberately conservative-but-not-absurd estimate for Indian delivery
    trades in liquid large-caps. Small-caps cost considerably more.
    """
    px = prices.sort_index()
    rows = []

    for i in range(lookback_m, len(px) - hold_m):
        form_date = px.index[i]
        past = px.iloc[i] / px.iloc[i - lookback_m] - 1
        fwd = px.iloc[i + hold_m] / px.iloc[i] - 1

        valid = past.notna() & fwd.notna()
        past, fwd = past[valid], fwd[valid]
        if len(past) < n_pick * 3:
            continue

        ranked = past.sort_values()
        losers = ranked.index[:n_pick]
        winners = ranked.index[-n_pick:]

        turnover_cost = cost_bps / 10_000
        rows.append(
            {
                "date": form_date,
                "n_stocks": len(past),
                "reversal": fwd[losers].mean() - turnover_cost,
                "momentum": fwd[winners].mean() - turnover_cost,
                "equal_weight": fwd.mean(),
                "loser_past": past[losers].mean(),
                "winner_past": past[winners].mean(),
            }
        )

    return pd.DataFrame(rows).set_index("date")


def summarise(bt: pd.DataFrame, hold_m: int = 12) -> pd.DataFrame:
    """Aggregate stats per rule. Overlapping windows -> treat significance with suspicion."""
    out = {}
    for rule in ("reversal", "momentum", "equal_weight"):
        r = bt[rule].dropna()
        if r.empty:
            continue
        years = hold_m / 12
        out[rule] = {
            "mean_ann": (1 + r.mean()) ** (1 / years) - 1,
            "median_ann": (1 + r.median()) ** (1 / years) - 1,
            "hit_rate_vs_0": (r > 0).mean(),
            "beats_eqwt": (r > bt["equal_weight"]).mean(),
            "worst": r.min(),
            "best": r.max(),
            "std": r.std(),
            "n_windows": len(r),
        }
    return pd.DataFrame(out).T
