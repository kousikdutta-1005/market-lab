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
import urllib.request
import urllib.error
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from marketlab import bhavcopy as bc
from marketlab import news
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
# Any loopback origin, because a Vite dev server takes whatever port is free and a fixed
# list of three ports silently broke the app the moment one of them was already in use.
# This process only ever binds localhost and only exists on a developer's machine, so
# there is no wider origin to protect against.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
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


@app.get("/api/chart/{symbol}")
def chart(symbol: str, range: str = "1y") -> dict:
    """Chart-ready price/volume series from the local NSE bhavcopy matrices."""
    import pandas as pd

    ranges = {"3m": 66, "6m": 126, "1y": 252, "2y": 504, "all": None}
    if range not in ranges:
        return JSONResponse({"error": f"unknown range {range!r}"}, status_code=400)

    sym = symbol.upper().strip()
    mats = bc.load(prefix="nse", fields=("close", "volume", "turnover"))
    close = mats.get("close")
    if close is None or close.empty or sym not in close.columns:
        return JSONResponse({"error": f"{sym} not found in local bhavcopy cache"}, status_code=404)

    px_full = pd.to_numeric(close[sym], errors="coerce").dropna()
    if px_full.empty:
        return JSONResponse({"error": f"{sym} has no price history"}, status_code=404)
    n = ranges[range]
    px = px_full.tail(n) if n else px_full
    idx = px.index
    base = float(px.iloc[0])

    ma50 = px_full.rolling(50).mean().reindex(idx)
    ma200 = px_full.rolling(200).mean().reindex(idx)
    vol = mats.get("volume", pd.DataFrame()).get(sym, pd.Series(index=idx, dtype=float)).reindex(idx)
    turnover = mats.get("turnover", pd.DataFrame()).get(sym, pd.Series(index=idx, dtype=float)).reindex(idx)

    market = close.reindex(idx).ffill(limit=5)
    market_norm = market.div(market.iloc[0]).replace([float("inf"), float("-inf")], pd.NA)
    market_return = (market_norm.mean(axis=1) - 1) * 100

    rows = []
    for d in idx:
        c = float(px.loc[d])
        rows.append(
            {
                "date": str(pd.Timestamp(d).date()),
                "close": round(c, 4),
                "return_pct": round((c / base - 1) * 100, 4) if base else None,
                "market_return_pct": None
                if pd.isna(market_return.loc[d])
                else round(float(market_return.loc[d]), 4),
                "ma50": None if pd.isna(ma50.loc[d]) else round(float(ma50.loc[d]), 4),
                "ma200": None if pd.isna(ma200.loc[d]) else round(float(ma200.loc[d]), 4),
                "volume": None if pd.isna(vol.loc[d]) else int(vol.loc[d]),
                "turnover": None if pd.isna(turnover.loc[d]) else round(float(turnover.loc[d]), 2),
            }
        )

    return {
        "symbol": sym,
        "range": range,
        "source": "NSE bhavcopy (exchange EOD)",
        "last_date": rows[-1]["date"] if rows else None,
        "points": rows,
    }


@app.get("/api/health")
def health():
    p = PUBLIC / "health.json"
    if not p.exists():
        return JSONResponse({"sources": []}, status_code=200)
    return FileResponse(p, media_type="application/json")


@app.get("/api/sources")
def sources() -> dict:
    """Live connectivity probe of the sources the tool actually depends on.

    Shares its implementation with the static build so the local view and the published
    snapshot can never drift into describing different things.
    """
    from marketlab import sources as src

    return {
        "checked_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "sources": src.probe_all(),
    }


if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="dist")

@app.post("/api/chat")
async def chat_api(request: Request):
    """Natural language AI agent that filters the table or returns charts."""
    data = await request.json()
    query = data.get("query", "")
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return JSONResponse({"error": "Missing GEMINI_API_KEY. Please export it in your terminal before running ./run.sh"}, status_code=400)

    system_prompt = """You are MarketLab AI, a financial assistant for the Indian stock market.
You control a stock screener UI. The user is asking you a question or giving a command.
You must respond with a JSON object containing:
1. "response": Your natural language reply to the user. Keep it concise.
2. "apply_formula": (Optional) A JavaScript boolean expression to filter the stock table.
   Available variables: pe, pb, roe, roa, dividend_yield, market_cap, sector, bucket (string: 'large','mid','small','micro','nano'), risk_level (string), opportunity_score, composite, delivery_accumulation_score, news_event_score.
   Example: "roe > 0.15 && bucket === 'large' && pe < 30"
3. "show_charts": (Optional) A list of stock symbols to display charts for. Example: ["RELIANCE", "TCS"]. Use NSE symbols only (without -EQ).

Only return valid JSON, no markdown formatting.
"""

    payload = {
        "contents": [{"parts": [{"text": query}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {
            "response_mime_type": "application/json",
        }
    }

    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload).encode("utf-8")
    )

    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode("utf-8"))
            text_response = result["candidates"][0]["content"]["parts"][0]["text"]
            ai_data = json.loads(text_response)
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        return JSONResponse({"error": f"API Error: {err_msg}"}, status_code=500)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    import pandas as pd
    charts_data = []
    if "show_charts" in ai_data and isinstance(ai_data["show_charts"], list):
        mats = bc.load(prefix="nse", fields=("close",))
        close = mats.get("close")
        if close is not None:
            for sym in ai_data["show_charts"]:
                sym = sym.upper().strip()
                if sym in close.columns:
                    px = pd.to_numeric(close[sym], errors="coerce").dropna().tail(126) # 6m
                    if not px.empty:
                        pts = [{"date": str(pd.Timestamp(d).date()), "close": float(px.loc[d])} for d in px.index]
                        charts_data.append({"symbol": sym, "points": pts})

    return {
        "response": ai_data.get("response", "Done."),
        "apply_formula": ai_data.get("apply_formula"),
        "charts": charts_data
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("ML_PORT", 8787)), log_level="warning")
