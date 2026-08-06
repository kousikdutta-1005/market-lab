"""Corporate-action adjustment for NSE bhavcopy prices.

WHY THIS EXISTS
NSE's bhavcopy is a settlement record, not an analytics feed: it reports the price that
actually traded each day and does **not** restate history when a company splits its stock
or issues a bonus. So the day HDFC Bank went ex-bonus, the close moved 1,964 -> 973 and
every naive calculation read that as a 50% crash.

That single unadjusted step silently corrupts almost everything downstream — 6 and 12
month returns, momentum and trend scores, volatility, drawdown, correlation and any
portfolio history. A stock that did a 1:10 split shows a -90% "return" and is ranked as a
falling knife when nothing happened to the business at all. A scan of the current universe
found 147 affected symbols.

HOW A SPLIT IS TOLD APART FROM A CRASH
A split changes the unit of quotation, not the value of the company, and the tape shows
that plainly:

    price x 1/n   and   volume x n   =>   turnover barely moves

A genuine collapse looks nothing like this: turnover spikes as people rush for the exit.
Requiring turnover continuity is what keeps a real crash from being "adjusted" away, which
would be a far worse error than leaving a split in.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Below/above these, a single-session move is not ordinary trading. NSE's 20% circuit
# limit means legitimate daily moves cannot approach a halving.
DROP_RATIO = 0.62
RISE_RATIO = 1.60

# A split leaves value traded in the same order of magnitude. A real crash does not:
# panic selling multiplies turnover. This is the primary discriminator.
TURNOVER_BAND = (0.12, 8.0)

# Volume should rise roughly with the split factor, but participation genuinely varies on
# an ex-date, so this is a supporting signal with generous slack rather than a hard gate.
# Tightening it to +/-0.55 log units rejected 97 unmistakable 1:10 splits.
VOLUME_TOLERANCE = 1.4

# Ratios companies actually use. Snapping avoids baking pennies of noise into history.
COMMON_FACTORS = [2, 2.5, 3, 4, 5, 6, 8, 10, 20, 25, 50, 100]


def _snap(factor: float) -> tuple[float, bool]:
    """Round to the nearest ratio a company would actually declare.

    Returns (factor, is_standard). Landing within a few percent of a declared ratio like
    1:10 is strong evidence on its own — a genuine crash has no reason to stop at exactly
    one tenth of the previous close.
    """
    inv = factor if factor >= 1 else 1.0 / factor
    best = min(COMMON_FACTORS, key=lambda f: abs(np.log(f) - np.log(inv)))
    close_enough = abs(np.log(best) - np.log(inv)) < 0.05
    if not close_enough:
        return float(factor), False
    snapped = float(best) if factor >= 1 else 1.0 / float(best)
    return snapped, True


def detect(close: pd.Series, volume: pd.Series | None, turnover: pd.Series | None) -> dict[pd.Timestamp, float]:
    """Find ex-dates and the factor prices must be divided by before them.

    Returns {date: factor}, where factor > 1 means a split/bonus (price fell) and
    factor < 1 means a reverse split (price rose).
    """
    px = pd.to_numeric(close, errors="coerce")
    ratio = px / px.shift(1)
    events: dict[pd.Timestamp, float] = {}

    suspects = ratio[(ratio < DROP_RATIO) | (ratio > RISE_RATIO)].dropna()
    for date, r in suspects.items():
        factor = 1.0 / float(r)

        snapped, is_standard = _snap(factor)

        turnover_ok = True
        if turnover is not None and date in turnover.index:
            tv = pd.to_numeric(turnover, errors="coerce")
            prev_tv = tv.shift(1).get(date)
            cur_tv = tv.get(date)
            if prev_tv and prev_tv > 0 and cur_tv is not None and np.isfinite(cur_tv):
                tv_ratio = cur_tv / prev_tv
                turnover_ok = TURNOVER_BAND[0] <= tv_ratio <= TURNOVER_BAND[1]
        if not turnover_ok:
            # Value traded exploded or vanished: real news, leave the price alone.
            continue

        volume_ok = True
        if volume is not None and date in volume.index:
            vol = pd.to_numeric(volume, errors="coerce")
            prev_v = vol.shift(1).get(date)
            cur_v = vol.get(date)
            if prev_v and prev_v > 0 and cur_v is not None and np.isfinite(cur_v) and cur_v > 0:
                vol_ratio = cur_v / prev_v
                # Expect volume to move roughly with the split factor, in log space.
                volume_ok = abs(np.log(vol_ratio) - np.log(factor)) <= VOLUME_TOLERANCE

        # A standard declared ratio plus intact turnover is already conclusive. Requiring
        # the volume match as well would reject real splits on quiet ex-dates.
        if not (is_standard or volume_ok):
            continue

        events[date] = snapped

    return events


def adjust(mats: dict[str, pd.DataFrame], on_log=print) -> tuple[dict[str, pd.DataFrame], dict]:
    """Back-adjust every price series for detected splits and bonuses.

    Prices before an ex-date are divided by the factor and volumes multiplied by it, so
    the series becomes continuous and comparable — the same convention every professional
    price feed uses. Turnover is already in rupees and needs no adjustment.
    """
    close = mats.get("close")
    if close is None or close.empty:
        return mats, {"ca_status": "no prices", "ca_symbols": 0, "ca_events": 0}

    volume = mats.get("volume")
    turnover = mats.get("turnover")

    price_frames = [k for k in ("close", "open", "high", "low", "vwap") if k in mats]
    out = {k: (v.copy() if isinstance(v, pd.DataFrame) else v) for k, v in mats.items()}

    total_events = 0
    touched: list[str] = []
    examples: list[str] = []

    for sym in close.columns:
        events = detect(
            close[sym],
            volume[sym] if volume is not None and sym in volume.columns else None,
            turnover[sym] if turnover is not None and sym in turnover.columns else None,
        )
        if not events:
            continue

        # Cumulative factor: prices before each ex-date carry every later action too.
        cum = pd.Series(1.0, index=close.index)
        for date, factor in events.items():
            cum.loc[cum.index < date] *= factor

        for key in price_frames:
            frame = out[key]
            if sym in frame.columns:
                frame[sym] = pd.to_numeric(frame[sym], errors="coerce") / cum
        if volume is not None and sym in out["volume"].columns:
            out["volume"][sym] = pd.to_numeric(out["volume"][sym], errors="coerce") * cum

        total_events += len(events)
        touched.append(sym)
        if len(examples) < 5:
            d, f = next(iter(events.items()))
            examples.append(f"{sym} 1:{f:g} on {pd.Timestamp(d).date()}")

    meta = {
        "ca_status": "ok",
        "ca_symbols": len(touched),
        "ca_events": total_events,
        "ca_examples": examples,
    }
    if touched:
        on_log(
            f"corporate actions: adjusted {len(touched)} symbols, {total_events} events "
            f"({', '.join(examples)}{'…' if len(touched) > 5 else ''})"
        )
    else:
        on_log("corporate actions: none detected")
    return out, meta
