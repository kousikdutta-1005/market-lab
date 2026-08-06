"""Whole-market fundamentals, fetched gently.

Yahoo rate-limited this IP earlier today for far less traffic than a naive
whole-market pull, so this runs at low concurrency with pauses and saves
incrementally: an interruption or a fresh ban costs the current chunk, not the run.
"""
import sys, time, threading
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from marketlab import fundamentals as fu, liquidity, universe as un

liq = pd.read_pickle("data/liquidity.pkl")
syms = [s for s in liq.index[liq["scoreable"]]]
out_path = "data/market_fundamentals.pkl"
try:
    done = pd.read_pickle(out_path)
except Exception:
    done = pd.DataFrame()
todo = [s for s in syms if f"{s}.NS" not in set(done.index)]
print(f"scoreable={len(syms)} already={len(done)} todo={len(todo)}", flush=True)

rows, lock, fails = [], threading.Lock(), [0]

def work(sym):
    tk = f"{sym}.NS"
    try:
        r = fu.fundamentals(tk)
    except Exception:
        r = {"ticker": tk}
        with lock: fails[0] += 1
    with lock:
        rows.append(r)
        n = len(rows)
    time.sleep(0.5)
    if n % 100 == 0:
        with lock:
            df = pd.concat([done, pd.DataFrame(rows).set_index("ticker")]) if len(done) else pd.DataFrame(rows).set_index("ticker")
            df.to_pickle(out_path)
        print(f"  {n}/{len(todo)} ({fails[0]} failed)", flush=True)

t0 = time.time()
with ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(work, todo))

df = pd.DataFrame(rows).set_index("ticker")
if len(done): df = pd.concat([done[~done.index.isin(df.index)], df])
df.to_pickle(out_path)
roe = df["roe"].notna().sum() if "roe" in df else 0
print(f"DONE {len(df)} rows, ROE on {roe}, {fails[0]} failed, {time.time()-t0:.0f}s", flush=True)
