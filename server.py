"""Local web backend: serves the dashboard, refreshes data, reports freshness.

Runs on localhost only. It exists because a static page cannot re-fetch market data —
a refresh button needs something that can execute the pipeline.

ON AUTO-REFRESH INTERVALS
The frontend polls /api/status frequently, and that is cheap and honest: the endpoint
reads in-memory state and touches no external service. What it does NOT do is re-fetch
market data on that cadence. NSE publishes the bhavcopy once per trading day, so polling
the exchange every few seconds would return identical bytes while looking busy — and
Yahoo, the alternative intraday source, has already rate-limited this IP across every
endpoint for far gentler use than that.

So: the UI updates continuously, the *data* updates when the data actually changes, and
/api/status reports the true age of each layer so the difference is visible rather than
implied.
"""

from __future__ import annotations

import os

import asyncio
import datetime as dt
import json
import threading
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from marketlab import bhavcopy as bc
from marketlab import pipeline

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "web" / "public"
DIST = ROOT / "web" / "dist"

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
MARKET_OPEN = dt.time(9, 15)
MARKET_CLOSE = dt.time(15, 30)
# NSE publishes the day's bhavcopy well after the close; before this there is nothing new.
BHAVCOPY_READY = dt.time(18, 30)

app = FastAPI(title="market-lab")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5177", "http://localhost:5180"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobState:
    def __init__(self) -> None:
        self.running = False
        self.stage = "idle"
        self.log: list[str] = []
        self.started: float | None = None
        self.finished: float | None = None
        self.error: str | None = None
        self.result: dict | None = None
        self.progress: dict | None = None
        self._lock = threading.Lock()

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "running": self.running,
                "stage": self.stage,
                "log": self.log[-40:],
                "started": self.started,
                "finished": self.finished,
                "error": self.error,
                "result": self.result,
                "progress": self.progress,
                "elapsed_s": round(time.time() - self.started, 1)
                if self.running and self.started
                else None,
            }


JOB = JobState()


def market_phase(now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(IST)
    t, wd = now.time(), now.weekday()
    weekend = wd >= 5
    if weekend:
        phase = "weekend"
    elif t < MARKET_OPEN:
        phase = "pre-open"
    elif t <= MARKET_CLOSE:
        phase = "open"
    elif t < BHAVCOPY_READY:
        phase = "closed - awaiting bhavcopy"
    else:
        phase = "closed"
    return {
        "phase": phase,
        "is_open": phase == "open",
        "now_ist": now.isoformat(timespec="seconds"),
        "new_data_expected": None if weekend else f"{BHAVCOPY_READY:%H:%M} IST",
    }


def _screen_meta() -> dict:
    p = PUBLIC / "screen.json"
    if not p.exists():
        return {"exists": False}
    try:
        d = json.loads(p.read_text())
    except Exception as e:
        return {"exists": True, "error": str(e)}
    meta = {k: v for k, v in d.items() if k not in ("stocks", "excluded")}
    meta["exists"] = True
    meta["age_s"] = round(time.time() - p.stat().st_mtime, 1)
    return meta


def _run_job(skip_fetch: bool) -> None:
    def log(msg: str) -> None:
        with JOB._lock:
            JOB.log.append(str(msg))
            JOB.stage = str(msg)

    with JOB._lock:
        JOB.running = True
        JOB.stage = "starting"
        JOB.log = []
        JOB.started = time.time()
        JOB.finished = None
        JOB.error = None
        JOB.result = None
    try:
        result = pipeline.run(on_log=log, skip_fetch=skip_fetch)
        with JOB._lock:
            JOB.result = result
            JOB.stage = "done"
    except Exception as e:
        with JOB._lock:
            JOB.error = f"{type(e).__name__}: {e}"
            JOB.stage = "failed"
    finally:
        with JOB._lock:
            JOB.running = False
            JOB.finished = time.time()


@app.get("/api/status")
def status() -> dict:
    """Cheap, in-memory. Safe to poll frequently — it calls nothing external."""
    return {
        "market": market_phase(),
        "data": _screen_meta(),
        "job": JOB.snapshot(),
        "server_time": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }


@app.post("/api/refresh")
def refresh(prices: bool = True) -> dict:
    if JOB.running:
        return JSONResponse({"started": False, "reason": "already running"}, status_code=409)
    threading.Thread(target=_run_job, args=(not prices,), daemon=True).start()
    return {"started": True}


@app.get("/api/screen")
def screen():
    p = PUBLIC / "screen.json"
    if not p.exists():
        return JSONResponse({"error": "no screen.json; run a refresh"}, status_code=404)
    return FileResponse(p, media_type="application/json")


@app.get("/api/health")
def health():
    p = PUBLIC / "health.json"
    if not p.exists():
        return JSONResponse({"sources": []}, status_code=200)
    return FileResponse(p, media_type="application/json")


@app.get("/api/sources")
def sources() -> dict:
    """Live connectivity probe of the sources the tool actually depends on."""
    import requests

    out = []

    def probe(name: str, fn, note: str = ""):
        t0 = time.time()
        try:
            ok, detail = fn()
        except Exception as e:
            ok, detail = False, f"{type(e).__name__}: {e}"
        out.append(
            {
                "name": name,
                "ok": bool(ok),
                "detail": str(detail),
                "ms": round((time.time() - t0) * 1000),
                "note": note,
            }
        )

    def nse_bhavcopy():
        d = bc.latest_available(max_back=6)
        return (d is not None), (f"latest session {d}" if d else "no recent file")

    def nse_indices():
        from marketlab import universe as un

        n = len(un.index_members("nifty50"))
        return n >= 45, f"{n} Nifty 50 constituents"

    def nse_equity_list():
        from marketlab import universe as un

        n = len(un.all_listed())
        return n > 1500, f"{n} listed securities"

    def yahoo():
        r = requests.get(
            "https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS",
            params={"range": "1d", "interval": "1d"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=20,
        )
        if r.status_code == 429:
            return False, "rate limited (HTTP 429)"
        return r.status_code == 200, f"HTTP {r.status_code}"

    probe("NSE bhavcopy", nse_bhavcopy, "primary price source, EOD")
    probe("NSE index lists", nse_indices, "universe + size buckets")
    probe("NSE equity list", nse_equity_list, "tradeable series filter")
    probe("Yahoo Finance", yahoo, "fundamentals only; optional")
    return {"checked_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "sources": out}


if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="dist")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("ML_PORT", 8787)), log_level="warning")
