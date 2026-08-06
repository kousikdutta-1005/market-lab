"""Corporate-action detection must fix splits without erasing real crashes."""
import pandas as pd
from marketlab import corporate_actions as ca


def series(vals, start="2025-01-01"):
    idx = pd.bdate_range(start, periods=len(vals))
    return pd.Series(vals, index=idx, dtype=float)


def test_detects_split():
    # Price halves, volume doubles, turnover flat: a 1:2 bonus.
    close = series([100, 100, 100, 50, 50, 50])
    vol = series([1000, 1000, 1000, 2000, 2000, 2000])
    tv = series([100000] * 6)
    ev = ca.detect(close, vol, tv)
    assert len(ev) == 1, ev
    assert abs(list(ev.values())[0] - 2.0) < 1e-6


def test_ignores_real_crash():
    # Price halves but turnover triples on panic volume: real news, must not adjust.
    close = series([100, 100, 100, 50, 50, 50])
    vol = series([1000, 1000, 1000, 20000, 5000, 4000])
    tv = series([100000, 100000, 100000, 1000000, 250000, 200000])
    assert ca.detect(close, vol, tv) == {}


def test_back_adjusts_history():
    close = pd.DataFrame({"X": series([100, 100, 50, 50])})
    vol = pd.DataFrame({"X": series([1000, 1000, 2000, 2000])})
    tv = pd.DataFrame({"X": series([100000] * 4)})
    out, meta = ca.adjust({"close": close, "volume": vol, "turnover": tv}, on_log=lambda *_: None)
    adj = out["close"]["X"].tolist()
    # Pre-split prices halve, so the series is continuous and the return is 0%, not -50%.
    assert adj == [50.0, 50.0, 50.0, 50.0], adj
    assert meta["ca_events"] == 1
    # Volume is scaled the other way so value traded stays consistent.
    assert out["volume"]["X"].tolist() == [2000.0, 2000.0, 2000.0, 2000.0]
