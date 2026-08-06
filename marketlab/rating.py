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


def _winsorised_pct_rank(
    s: pd.Series, higher_is_better: bool, groups: pd.Series | None = None, lo=0.02, hi=0.98
) -> pd.Series:
    """Percentile rank with extremes clipped, optionally computed within groups.

    Indian small/mid-caps throw absurd outliers (P/E of 4000 after a bad quarter).
    Clipping stops one bad print from dominating an entire pillar.

    When `groups` is given, both the clipping and the ranking happen inside each group.
    Across the full market that matters more than it looks: a nano-cap's P/E percentile
    against Reliance's is not a comparison of anything. Size buckets differ
    systematically in margin, leverage and rating, so a single market-wide rank mostly
    measures company size and calls it quality.
    """
    v = pd.to_numeric(s, errors="coerce")

    def rank_one(x: pd.Series) -> pd.Series:
        if x.notna().sum() < 3:
            return pd.Series(np.nan, index=x.index)
        c = x.clip(x.quantile(lo), x.quantile(hi))
        r = c.rank(pct=True, na_option="keep")
        return r if higher_is_better else 1 - r

    if groups is None:
        return rank_one(v)
    g = groups.reindex(v.index)
    return v.groupby(g, dropna=False, group_keys=False).apply(rank_one).reindex(v.index)


def score(
    combined: pd.DataFrame,
    pillars: dict | None = None,
    min_coverage: float = 0.5,
    groups: pd.Series | None = None,
) -> pd.DataFrame:
    """Composite percentile score. Requires >= min_coverage of metrics present.

    `groups` (e.g. size bucket) makes every rank peer-relative rather than market-wide.
    """
    pillars = pillars or PILLARS
    out = pd.DataFrame(index=combined.index)
    present: dict[str, list[str]] = {}

    for pillar, metrics in METRICS.items():
        cols = []
        for metric, higher in metrics:
            if metric not in combined.columns:
                continue
            ranked = _winsorised_pct_rank(combined[metric], higher, groups=groups)
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

    # A score built only on price history is a different claim from one that also saw
    # the accounts, and collapsing both into one number hides which you are looking at.
    # Rather than discard every stock without fundamentals — which across the whole
    # market would silently delete most of it — say plainly what each score rests on.
    fundamental_pillars = ["quality", "growth", "valuation"]
    technical_pillars = ["trend", "momentum"]
    has_fundamental = out[fundamental_pillars].notna().any(axis=1)
    n_pillars = out[list(METRICS)].notna().sum(axis=1)

    out["pillars_used"] = n_pillars
    out["rating_basis"] = np.where(has_fundamental, "fundamental + technical", "technical only")

    # Require at least two pillars; a single pillar is one opinion wearing a composite's
    # clothing. Fundamental-backed scores additionally need real metric coverage.
    ok = n_pillars >= 2
    ok &= np.where(has_fundamental, out["coverage"] >= min_coverage, True)
    ok &= out[technical_pillars].notna().any(axis=1)
    out.loc[~ok, "composite"] = np.nan
    out.loc[~ok, "rating_basis"] = "not rated"

    # A mean of 5 percentile ranks is arithmetically compressed toward 50 relative to a
    # mean of 2 — averaging shrinks variance by roughly 1/sqrt(n). Sorting both kinds of
    # score in one column therefore ranks stocks by how little data they had, not by how
    # they look: measured on real output, technical-only names took 100% of the top 100
    # AND 100% of the bottom 50 purely through this effect. Re-rank each score against
    # others computed the same way, so a number always means "position among stocks
    # judged on the same evidence".
    #
    # The same argument applies to size. Every pillar is already ranked within bucket, so
    # a raw composite of 86 means "ahead of most nano caps" and 70 means "ahead of most
    # large caps" — comparing those two numbers compares the *shape* of each bucket's
    # distribution, not the companies. Measured: nano's raw spread is wider (std 12.9 vs
    # 10.6), and it took 64% of the top 100 AND 68% of the bottom 100 off 56% of the
    # universe. Over-representation at both ends at once is noise, not skill.
    out["composite_raw"] = out["composite"]
    comparability = out["rating_basis"].astype(str)
    if groups is not None:
        comparability = comparability + "|" + groups.reindex(out.index).astype(str)
    out["composite"] = (
        out.groupby(comparability)["composite_raw"]
        .rank(pct=True)
        .mul(100)
        .where(out["composite_raw"].notna())
    )

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
