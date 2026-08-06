"""Pull 2 years of whole-market EOD from NSE bhavcopy and save pivoted matrices."""
import datetime as dt, time
from marketlab import bhavcopy as bc, bulk

t0 = time.time()
end = bc.latest_available() or dt.date.today()
start = end - dt.timedelta(days=730)
days = bc.trading_days(start, end)
print(f"range {start} .. {end}  ({len(days)} weekdays)", flush=True)

p = bulk.Progress(len(days), "bhavcopy")
long = bc.fetch_range(start, end, workers=6, progress=p,
                      on_log=lambda m: print(m, flush=True))
print(f"long rows: {len(long):,}  symbols: {long.symbol.nunique():,}", flush=True)

mats = bc.matrices(long)
bc.save(mats, prefix="nse")
for k, v in mats.items():
    print(f"  {k:9s} {v.shape}", flush=True)
print(f"DONE in {time.time()-t0:.0f}s", flush=True)
