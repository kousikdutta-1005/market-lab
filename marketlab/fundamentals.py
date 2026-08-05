"""Fundamental metrics for NSE stocks, computed from financial statements.

Deliberately computes ROE / margins / growth from the statements rather than
reading yfinance's `info` dict, which is missing returnOnEquity, freeCashflow,
currentRatio and returnOnAssets for many Indian tickers (verified on RELIANCE.NS).
Valuation multiples still come from `info` since they need a live price.
"""

from __future__ import annotations

import time
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")


def _row(df: pd.DataFrame, *names: str) -> pd.Series | None:
    """First matching row from a statement, tolerating yfinance's naming drift."""
    if df is None or df.empty:
        return None
    for n in names:
        if n in df.index:
            s = df.loc[n]
            return s.iloc[0] if isinstance(s, pd.DataFrame) else s
    return None


def _cagr_from_statement(s: pd.Series | None) -> float:
    """Annualised growth across available statement years (newest column first)."""
    if s is None:
        return np.nan
    v = s.dropna().astype(float)
    if len(v) < 2:
        return np.nan
    latest, oldest = v.iloc[0], v.iloc[-1]
    years = len(v) - 1
    if oldest <= 0 or latest <= 0:
        return np.nan
    return (latest / oldest) ** (1 / years) - 1


def fundamentals(ticker: str) -> dict:
    """Quality, growth and valuation metrics for one ticker."""
    import yfinance as yf

    t = yf.Ticker(ticker)
    out: dict = {"ticker": ticker}

    try:
        info = t.info or {}
    except Exception:
        info = {}

    try:
        bs, fin = t.balance_sheet, t.financials
    except Exception:
        bs = fin = pd.DataFrame()

    equity = _row(bs, "Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest")
    debt = _row(bs, "Total Debt", "Long Term Debt And Capital Lease Obligation")
    assets = _row(bs, "Total Assets")
    net_income = _row(fin, "Net Income", "Net Income Common Stockholders")
    revenue = _row(fin, "Total Revenue", "Operating Revenue")
    ebit = _row(fin, "EBIT", "Operating Income")

    def latest(s):
        if s is None:
            return np.nan
        v = s.dropna()
        return float(v.iloc[0]) if len(v) else np.nan

    eq, ni, rev, eb, dbt, ast = map(latest, (equity, net_income, revenue, ebit, debt, assets))

    flags: list[str] = []

    # Negative book equity makes ROE and D/E meaningless — and worse, actively
    # misleading: a loss-making firm with negative equity produces a large POSITIVE
    # ROE. Verified on IDEA.NS (equity -357bn). Suppress rather than report.
    if eq is not None and not np.isnan(eq) and eq <= 0:
        flags.append("negative_equity")

    out["roe"] = ni / eq if eq and eq > 0 and not np.isnan(ni) else np.nan
    out["roa"] = ni / ast if ast and ast > 0 and not np.isnan(ni) else np.nan
    out["debt_to_equity"] = dbt / eq if eq and eq > 0 and not np.isnan(dbt) else np.nan

    op_margin = eb / rev if rev and rev > 0 and not np.isnan(eb) else np.nan
    net_margin = ni / rev if rev and rev > 0 and not np.isnan(ni) else np.nan

    # Operating profit cannot exceed revenue in normal operations. When it does,
    # the line contains an exceptional item (one-off waiver, asset sale, tax
    # writeback) and the ratio describes an accounting event, not the business.
    # IDEA.NS showed a 125% operating margin and 77% net margin this way.
    # Evaluate both checks against the ORIGINAL values before nulling either —
    # comparing against an already-NaN'd operating margin silently passes.
    op_bad = np.isfinite(op_margin) and abs(op_margin) > 1.0
    net_bad = np.isfinite(net_margin) and abs(net_margin) > 1.0
    net_exceeds = (
        np.isfinite(net_margin) and np.isfinite(op_margin) and net_margin > op_margin + 0.05
    )

    if op_bad:
        flags.append("implausible_operating_margin")
        op_margin = np.nan
    if net_bad:
        flags.append("implausible_net_margin")
        net_margin = np.nan
    elif net_exceeds or op_bad:
        # Same statements produced the bad operating figure, so the net figure
        # drawn from them is equally untrustworthy.
        flags.append("net_margin_unreliable")
        net_margin = np.nan

    out["operating_margin"] = op_margin
    out["net_margin"] = net_margin
    out["revenue_cagr"] = _cagr_from_statement(revenue)
    out["earnings_cagr"] = _cagr_from_statement(net_income)
    out["data_flags"] = ",".join(flags)

    out["pe"] = info.get("trailingPE")
    out["pb"] = info.get("priceToBook")
    out["ev_ebitda"] = info.get("enterpriseToEbitda")
    out["market_cap"] = info.get("marketCap")
    out["dividend_yield"] = info.get("dividendYield")
    out["sector"] = info.get("sector")
    out["name"] = info.get("longName") or info.get("shortName")
    out["years_of_data"] = 0 if net_income is None else int(net_income.dropna().shape[0])
    return out


def fetch_many(tickers: list[str], pause: float = 0.4, verbose: bool = True) -> pd.DataFrame:
    rows = []
    for i, tk in enumerate(tickers, 1):
        try:
            rows.append(fundamentals(tk))
        except Exception:
            rows.append({"ticker": tk})
        time.sleep(pause)
        if verbose and i % 25 == 0:
            print(f"  fundamentals {i}/{len(tickers)}", flush=True)
    return pd.DataFrame(rows).set_index("ticker")
