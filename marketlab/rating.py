"""Transparent composite rating for NSE stocks.

WHAT THIS IS: a cross-sectional description of a stock's CURRENT measurable
characteristics — quality, growth, valuation, trend, momentum — expressed as a
percentile rank against its peer universe. Every input is visible and auditable.

WHAT THIS IS NOT: a forecast, a price target, or advice. A high score means
"this stock currently scores well on these specific published metrics", not
"this stock will go up". Those are different claims and only the first is
something data can support.

Scores are RELATIVE to the universe on the day you run it. A 90th-percentile
stock in a falling market is still probably falling.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252

# Weights are a judgement call, not a discovered optimum. They are deliberately
# round numbers: tuning them against past returns is exactly how backtests get
# overfitted. Edit them if you disagree — that is the point of them being here.
PILLARS = {"quality": 0.30, "growth": 0.20, "valuation": 0.20, "trend": 0.15, "momentum": 0.15}

# (metric, higher_is_better)
METRICS = {
    "quality": [("roe", True), ("operating_margin", True), ("net_margin", True), ("debt_to_equity", False)],
    "growth": [("revenue_cagr", True), ("earnings_cagr", True)],
    "valuation": [("pe", False), ("pb", False), ("ev_ebitda", False)],
    "trend": [("above_50dma", True), ("above_200dma", True), ("dist_52w_high", True)],
    "momentum": [("mom_6m_risk_adj", True), ("mom_12m_risk_adj", True), ("rs_vs_nifty", True)],
}


def technicals(daily_px: pd.DataFrame, benchmark: pd.Series, asof: pd.Timestamp | None = None) -> pd.DataFrame:
    """Trend and momentum features for every column of `daily_px`."""
    px = daily_px.loc[:asof] if asof is not None else daily_px
    last = px.iloc[-1]

    ma50, ma200 = px.tail(50).mean(), px.tail(200).mean()
    high52 = px.tail(TRADING_DAYS).max()

    logret = np.log(px / px.shift(1))
    vol = logret.tail(TRADING_DAYS).std() * np.sqrt(TRADING_DAYS)

    def ret(months: int) -> pd.Series:
        cutoff = px.index[-1] - pd.DateOffset(months=months)
        prior = px.loc[:cutoff]
        return last / prior.iloc[-1] - 1 if len(prior) else pd.Series(np.nan, index=px.columns)

    r6, r12 = ret(6), ret(12)

    bench = benchmark.loc[: px.index[-1]]
    b_cut = bench.index[-1] - pd.DateOffset(months=12)
    b_prior = bench.loc[:b_cut]
    bench_12m = bench.iloc[-1] / b_prior.iloc[-1] - 1 if len(b_prior) else np.nan

    df = pd.DataFrame(
        {
            "price": last,
            "ann_vol": vol,
            "above_50dma": (last / ma50 - 1) * 100,
            "above_200dma": (last / ma200 - 1) * 100,
            "dist_52w_high": (last / high52 - 1) * 100,
            "ret_6m": r6,
            "ret_12m": r12,
        }
    )
    df["mom_6m_risk_adj"] = df["ret_6m"] / df["ann_vol"]
    df["mom_12m_risk_adj"] = df["ret_12m"] / df["ann_vol"]
    df["rs_vs_nifty"] = df["ret_12m"] - bench_12m
    return df


def _winsorised_pct_rank(s: pd.Series, higher_is_better: bool, lo=0.02, hi=0.98) -> pd.Series:
    """Percentile rank with extremes clipped.

    Indian small/mid-caps throw absurd outliers (P/E of 4000 after a bad quarter).
    Clipping stops one bad print from dominating an entire pillar.
    """
    v = pd.to_numeric(s, errors="coerce")
    if v.notna().sum() < 3:
        return pd.Series(np.nan, index=s.index)
    v = v.clip(v.quantile(lo), v.quantile(hi))
    r = v.rank(pct=True, na_option="keep")
    return r if higher_is_better else 1 - r


def score(
    combined: pd.DataFrame, pillars: dict | None = None, min_coverage: float = 0.5
) -> pd.DataFrame:
    """Composite percentile score. Requires >= min_coverage of metrics present."""
    pillars = pillars or PILLARS
    out = pd.DataFrame(index=combined.index)
    present: dict[str, list[str]] = {}

    for pillar, metrics in METRICS.items():
        cols = []
        for metric, higher in metrics:
            if metric not in combined.columns:
                continue
            ranked = _winsorised_pct_rank(combined[metric], higher)
            if ranked.notna().sum() == 0:
                continue
            out[f"_{metric}"] = ranked
            cols.append(f"_{metric}")
        present[pillar] = cols
        out[pillar] = out[cols].mean(axis=1) * 100 if cols else np.nan

    # Renormalise pillar weights per row so a stock missing a whole pillar is
    # scored on what it does have, rather than silently penalised to zero.
    weights = pd.DataFrame(
        {p: np.where(out[p].notna(), pillars.get(p, 0), 0) for p in METRICS}, index=out.index
    )
    wsum = weights.sum(axis=1)
    contrib = (out[list(METRICS)].fillna(0) * weights).sum(axis=1)
    out["composite"] = np.where(wsum > 0, contrib / wsum.replace(0, np.nan), np.nan)

    all_metric_cols = [f"_{m}" for ms in METRICS.values() for m, _ in ms if f"_{m}" in out.columns]
    out["coverage"] = out[all_metric_cols].notna().mean(axis=1)
    out.loc[out["coverage"] < min_coverage, "composite"] = np.nan

    out["band"] = pd.cut(
        out["composite"],
        [-0.01, 20, 40, 60, 80, 100.01],
        labels=["bottom quintile", "below average", "average", "above average", "top quintile"],
    )
    return out.drop(columns=[c for c in out.columns if c.startswith("_")]).sort_values(
        "composite", ascending=False
    )


def explain(combined: pd.DataFrame, scored: pd.DataFrame, ticker: str) -> str:
    """Why one stock scored what it did — every input, visible."""
    if ticker not in scored.index:
        return f"{ticker}: not in universe"
    s, c = scored.loc[ticker], combined.loc[ticker]
    lines = [
        f"{ticker}  {c.get('name') or ''}",
        f"  sector      {c.get('sector') or 'n/a'}",
        f"  COMPOSITE   {s['composite']:.0f}/100  ({s['band']}, {s['coverage']*100:.0f}% data coverage)",
        "",
    ]
    for pillar in METRICS:
        val = s.get(pillar)
        lines.append(f"  {pillar:10s} {'n/a' if pd.isna(val) else f'{val:5.0f}'}")
        for metric, _ in METRICS[pillar]:
            if metric in c.index:
                raw = c[metric]
                lines.append(f"      {metric:20s} {'n/a' if pd.isna(raw) else f'{raw:>12.2f}'}")
    lines += [
        "",
        "  This describes current measured characteristics. It is not a forecast",
        "  and not advice. Ranks are relative to the universe on this date only.",
    ]
    return "\n".join(lines)
