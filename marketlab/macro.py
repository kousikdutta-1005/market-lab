"""Free market-regime layer derived from the same exchange data as the board."""

from __future__ import annotations

import numpy as np
import pandas as pd


def build(mats: dict[str, pd.DataFrame], universe: pd.DataFrame) -> dict:
    close = mats["close"].copy()
    close = close[[c for c in close.columns if c in universe.index]]
    if len(close) < 220:
        return {"macro_status": "unavailable"}

    last = close.iloc[-1]
    prev = close.iloc[-2]
    ma50 = close.tail(50).mean()
    ma200 = close.tail(200).mean()
    ret_1m = last / close.iloc[-22] - 1 if len(close) > 22 else pd.Series(np.nan, index=close.columns)

    advancers = int((last > prev).sum())
    decliners = int((last < prev).sum())
    traded = int((last.notna() & prev.notna()).sum())
    above_50 = float((last > ma50).mean() * 100)
    above_200 = float((last > ma200).mean() * 100)
    median_1m = float(ret_1m.median() * 100)
    breadth = advancers / max(advancers + decliners, 1) * 100

    if above_50 >= 60 and above_200 >= 55 and breadth >= 52:
        regime = "risk-on"
        summary = "Broad participation: most stocks are above trend and today's breadth is positive."
    elif above_50 < 40 or above_200 < 45 or breadth < 45:
        regime = "risk-off"
        summary = "Fragile tape: participation is narrow or falling, so factor scores need stricter risk checks."
    else:
        regime = "mixed"
        summary = "Mixed tape: opportunity exists, but broad confirmation is not strong."

    return {
        "macro_status": "ok",
        "market_regime": regime,
        "market_regime_summary": summary,
        "breadth_advancers": advancers,
        "breadth_decliners": decliners,
        "breadth_traded": traded,
        "breadth_advance_pct": round(breadth, 2),
        "above_50dma_pct": round(above_50, 2),
        "above_200dma_pct": round(above_200, 2),
        "median_1m_return_pct": round(median_1m, 2) if np.isfinite(median_1m) else None,
    }
