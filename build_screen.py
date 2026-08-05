#!/usr/bin/env python
"""Build the JSON the React dashboard reads.

Combines fundamentals + technicals, scores them, and writes web/public/screen.json.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from marketlab import crosssection as cs
from marketlab import equity, rating

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "web" / "public" / "screen.json"


def clean(v):
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else round(float(v), 6)
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    return v


def main() -> int:
    px = pd.read_pickle(ROOT / "data" / "n200_daily.pkl")
    fund = pd.read_pickle(ROOT / "data" / "n200_fundamentals.pkl")
    universe = cs.load_universe(ROOT / "data" / "nifty200.csv").set_index("ticker")

    bench = equity.history("nifty50", range_="15y", interval="1d")["adj_close"]
    tech = rating.technicals(px, bench)

    combined = tech.join(fund, how="outer").join(universe[["company_name", "industry"]], how="left")
    combined["name"] = combined["name"].fillna(combined["company_name"])
    combined["sector"] = combined["sector"].fillna(combined["industry"])

    scored = rating.score(combined)
    merged = combined.join(scored, how="inner", rsuffix="_s")
    merged = merged[merged["composite"].notna()].sort_values("composite", ascending=False)

    metric_cols = [m for ms in rating.METRICS.values() for m, _ in ms]
    keep = ["name", "sector", "price", "market_cap", "composite", "coverage", "band",
            "ret_6m", "ret_12m", "ann_vol", "years_of_data", "data_flags",
            *rating.METRICS.keys(), *metric_cols]

    rows = []
    for tk, r in merged.iterrows():
        row = {"ticker": str(tk).replace(".NS", "")}
        for c in keep:
            if c in r.index:
                v = r[c]
                if c in ("band", "data_flags"):
                    row[c] = str(v) if pd.notna(v) and str(v) else None
                else:
                    row[c] = clean(v)
        rows.append(row)

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "as_of": str(px.index[-1].date()),
        "universe": "Nifty 200 (NSE official constituent list)",
        "n_scored": len(rows),
        "n_universe": len(universe),
        "weights": rating.PILLARS,
        "metrics": {k: [m for m, _ in v] for k, v in rating.METRICS.items()},
        "stocks": rows,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1))
    print(f"wrote {OUT}  ({len(rows)} stocks scored of {len(universe)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
