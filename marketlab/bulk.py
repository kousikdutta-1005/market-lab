"""Fetching the whole market without getting throttled or losing progress.

2,078 stocks is enough that naive sequential fetching takes hours and any failure
loses everything. This module is threaded, retrying, and resumable — resumability
comes for free from the on-disk cache in `marketlab.cache`, so a re-run after a
crash re-reads local files instead of the network.

Concurrency is deliberately modest. Yahoo's public chart endpoint has no documented
rate limit, which means the limit is discovered by being cut off. Eight workers with
backoff has proven stable; raising it trades reliability for minutes.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

from . import equity

DATA = Path(__file__).resolve().parent.parent / "data"

WORKERS = 8
RETRIES = 3
BACKOFF = 2.0


class Progress:
    """Thread-safe counter the web backend can poll while a fetch is running."""

    def __init__(self, total: int, label: str = "") -> None:
        self.total = total
        self.done = 0
        self.failed = 0
        self.label = label
        self.started = time.time()
        self._lock = threading.Lock()

    def tick(self, ok: bool) -> None:
        with self._lock:
            self.done += 1
            if not ok:
                self.failed += 1

    def snapshot(self) -> dict:
        with self._lock:
            elapsed = time.time() - self.started
            rate = self.done / elapsed if elapsed > 0 else 0
            remaining = (self.total - self.done) / rate if rate > 0 else None
            return {
                "label": self.label,
                "total": self.total,
                "done": self.done,
                "failed": self.failed,
                "elapsed_s": round(elapsed, 1),
                "eta_s": round(remaining, 1) if remaining is not None else None,
            }


def _one(ticker: str, range_: str, interval: str, max_age_s: float) -> pd.DataFrame | None:
    for attempt in range(RETRIES):
        try:
            h = equity.history(ticker, range_=range_, interval=interval, max_age_s=max_age_s)
            if h is None or h.empty:
                return None
            return h
        except Exception:
            if attempt == RETRIES - 1:
                return None
            time.sleep(BACKOFF * (attempt + 1))
    return None


def fetch_history(
    tickers: list[str],
    range_: str = "3y",
    interval: str = "1d",
    max_age_s: float = 12 * 3600,
    workers: int = WORKERS,
    progress: Progress | None = None,
    on_log=None,
) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    """Returns (close, volume, failed_tickers) as date x ticker matrices."""
    closes: dict[str, pd.Series] = {}
    volumes: dict[str, pd.Series] = {}
    failed: list[str] = []
    lock = threading.Lock()

    def work(t: str) -> None:
        h = _one(t, range_, interval, max_age_s)
        ok = h is not None
        with lock:
            if ok:
                closes[t] = h["adj_close"] if "adj_close" in h else h["close"]
                volumes[t] = h["volume"] if "volume" in h else pd.Series(dtype=float)
            else:
                failed.append(t)
        if progress:
            progress.tick(ok)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(work, t): t for t in tickers}
        for i, _ in enumerate(as_completed(futures), 1):
            if on_log and i % 100 == 0:
                on_log(f"  {i}/{len(tickers)} fetched ({len(failed)} failed)")

    close = pd.DataFrame(closes).sort_index()
    volume = pd.DataFrame(volumes).sort_index()
    for df in (close, volume):
        if not df.empty:
            df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    return close, volume, failed


def save(close: pd.DataFrame, volume: pd.DataFrame, prefix: str = "market") -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    close.to_pickle(DATA / f"{prefix}_close.pkl")
    volume.to_pickle(DATA / f"{prefix}_volume.pkl")


def load(prefix: str = "market") -> tuple[pd.DataFrame, pd.DataFrame]:
    return (
        pd.read_pickle(DATA / f"{prefix}_close.pkl"),
        pd.read_pickle(DATA / f"{prefix}_volume.pkl"),
    )
