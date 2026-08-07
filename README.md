# market-lab

Read-only research toolkit for Indian mutual funds and the whole NSE-listed equity market.

**No credentials. No broker connection. No order placement.** By design — this layer
only reads public data. Execution is a separate decision, deliberately not built yet.

## Setup

```bash
cd ~/Projects/market-lab
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

## Usage

```bash
./.venv/bin/python cli.py mf search "parag parikh flexi" --direct --growth
./.venv/bin/python cli.py mf stats 122639
./.venv/bin/python cli.py mf compare 122639 120503 --benchmark nifty50
./.venv/bin/python cli.py eq quote RELIANCE.NS
./.venv/bin/python cli.py eq stats nifty50 --range 10y
```

Index shortcuts: `nifty50`, `banknifty`, `sensex`, `niftymidcap150`.
Equities use Yahoo suffixes: `.NS` (NSE), `.BO` (BSE).

## Data sources

| What | Source | Auth | Notes |
|---|---|---|---|
| MF universe + daily NAV | AMFI `portal.amfiindia.com/spages/NAVAll.txt` | none | official, ~17k schemes |
| MF NAV history | `api.mfapi.in` | none | unofficial mirror of AMFI |
| Equity / index OHLCV | Yahoo Finance chart API | none | delayed, unofficial |
| Whole-market EOD prices | NSE bhavcopy (`nsearchives.nseindia.com`) | none | **primary price source** — one file per trading day covers every security |
| Universe + size buckets | NSE index constituent CSVs + `EQUITY_L.csv` | none | official; SEBI-aligned large/mid/small/micro buckets |
| Official corporate events | NSE corporate announcements + BSE announcements | none | 14-day NSE backbone plus bounded same-day BSE disclosures |
| Large deals | NSE large-deal snapshot | none | bulk, block and short-deal activity, shown as evidence rather than direction |
| Delivery participation | NSE `sec_bhavdata_full` | none | latest and 20-session delivery percentage/value context |
| Risk lens | NSE F&O ban + local diagnostics | none | F&O ban, volatility, drawdown, liquidity and data-quality flags |
| Market regime | Derived from NSE bhavcopy breadth | none | advancers/decliners, participation above 50/200 DMA and median 1-month return |
| Fundamentals | Yahoo Finance statements | none | quarterly; 1,582 of 1,606 stocks have ROE |

Responses are cached under `data/cache/` so repeated runs don't hammer public endpoints.

## Metrics

`cagr`, `trailing_returns`, `volatility`, `sharpe`, `max_drawdown`, `rolling_returns`, `summary`.

Rolling returns matter most. A single trailing CAGR is a function of the start date you
happened to pick; the distribution of *every* 3-year window is much harder to fool yourself with.

## Known caveats — read these before trusting a number

- **Nifty via Yahoo is a price index, not TRI.** It excludes dividends, so it understates
  the true benchmark by roughly 1–1.5%/yr. Any fund "beating Nifty" by less than that
  margin is not actually beating it.
- **Yahoo silently downgrades granularity** on long ranges (`max` returns monthly candles).
  Metrics infer sampling frequency from the index and annualise accordingly, and the CLI
  prints which granularity was used. Drawdowns computed on monthly bars understate the
  real intra-month drawdown.
- **Public NAV feeds contain bad rows.** Axis ELSS (120503) has a literal `0.0` NAV on
  2013-04-07 which produced a fake -100% drawdown. Non-positive values are filtered out.
  Assume more bad rows exist that haven't been found yet.
- **Survivorship bias.** AMFI's list is live schemes only. Funds that died aren't here,
  so any cross-sectional "best fund" study is biased upward.
- **NAV is post-expense but pre-exit-load and pre-tax.** Real returns are lower.
- **Direct vs Regular plans differ by ~1%/yr.** Compare like with like.

## Running it

```bash
./run.sh              # build if needed, serve on :8787, open the browser
./run.sh --refresh    # pull the latest bhavcopy and rescore first (needs internet)
./run.sh --port 9000  # use a different port
```

`run.sh` is the local path: it builds the UI and starts a small FastAPI process so the
**Refresh** button can actually run the pipeline. The public site at
`experiments.kousikdutta.com` is the same build with no backend at all.

One thing to be deliberate about: publishing stock scores in India sits near
SEBI's research-analyst rules. This is why the tool ranks *research fit* rather than
issuing buy/sell calls, names no price targets, states its method and sources in full,
and carries "for research and education only, not investment advice, not SEBI-registered"
on every page. That framing is load-bearing, not decoration — do not let a future change
turn a score into a recommendation.

React 19 + Vite + Tailwind 4 + lucide-react + recharts, served by a small local FastAPI
backend so the **Refresh** button in the UI can actually run the pipeline. Sortable factor
table across the whole market, filterable by size bucket, with a liquidity column; click
any row for a full breakdown: pillar radar, every raw metric, position-size impact, and any
data quality flags that caused a value to be suppressed.

### Coverage

| | |
|---|---|
| Listed NSE stocks (EQ series) | 2,078 |
| Pass the liquidity gate | 1,801 |
| Have enough history to score | 1,606 |
| Scored | 1,602 |

The 470 excluded stocks are listed in the UI with the reason for each, rather than
silently dropped.

### Refresh and auto-update

The board re-reads server state every 5 seconds and shows the true age of the data. The
underlying data does **not** change that fast, and the UI says so plainly:

| Layer | Actually changes |
|---|---|
| Prices | once per trading day, when NSE publishes the bhavcopy (~18:30 IST) |
| Fundamentals | when companies file results — roughly quarterly |
| Scores | only when one of the above moves |

There is no intraday feed here. Yahoo rate-limits this kind of polling across every
endpoint, and NSE's live quote API returns 403 without a browser session. A UI that polled
an exchange every 5 seconds would return identical bytes while looking busy, so this one
reports data age instead of implying it is live.

The rating is a **percentile rank of measured characteristics**, not a call. Pillars:
quality 30%, growth 20%, valuation 20%, trend 15%, momentum 15%. Those weights are
deliberately round numbers in `marketlab/rating.py` — tuning them against past returns is
precisely how a backtest becomes fiction. Change them if you disagree; that is why they are
visible.

## Data quality bugs found and fixed

Real defects caught while building this, each of which would have silently corrupted results:

| Bug | Effect | Fix |
|---|---|---|
| `0.0` NAV in Axis ELSS history (2013-04-07) | fake −100% drawdown | filter non-positive values |
| Yahoo silently returns monthly candles for long ranges | Nifty volatility reported as 93.5% | infer sampling frequency from the index, annualise accordingly, surface it |
| Negative book equity (IDEA: −₹357bn) | loss-making firm showed a large *positive* ROE | suppress ROE and D/E when equity ≤ 0 |
| Operating profit exceeding revenue (IDEA: 125% margin) | exceptional items scored as operating strength; ranked #8 of 200 | suppress margins outside ±100%; stock fell to #79 |
| `niftystocks` package universe stale | wrong on 11 of 50 Nifty 50 names, still listing HDFC (merged 2023) | fetch NSE's published constituent list live |
| yfinance `info` missing ROE/FCF for Indian tickers | ~0% coverage on key quality metrics | compute from financial statements instead — ROE coverage went to 99% |
| NSE ships `DUMMYINXGN` / `DUMMYTRVN` placeholder rows inside its own index CSVs | Nifty Total Market returned 752 "stocks", Microcap 250 returned 252 | filter `DUMMY*` symbols explicitly |
| Liquidity gate conflated "tradeable" with "has enough history" | GROWW (₹513 cr/day) and LG Electronics India rejected as *illiquid* | split into separate `tradeable` and `scoreable` tests |
| Composite averaged 5 pillar ranks for some stocks and 2 for others | averaging shrinks variance ~1/√n, so data-poor stocks took **100% of the top 100 and 100% of the bottom 50** | re-rank the composite within its comparability class |
| Same effect across size buckets | nano caps took 64% of the top 100 *and* 68% of the bottom 100 off 56% of the universe | rank within (size bucket × rating basis); every bucket now lands in both tails at its universe share |
| Export dropped columns absent from the frame | missing keys became `undefined` in JS, slipping past `!== null` guards and crashing the detail pane | always emit every key as explicit `null` |



### 1. Survivorship bias inflated my own backtest by ~21 points a year

Backtesting on today's Nifty 200 constituents over 2007-2026 produced a **30.1% annual**
return for simply equal-weighting the universe. The Nifty 50 actually returned **9.4%**
over the same period.

That ~21pp/year gap is not a strategy. It is the arithmetic of only holding companies
that were successful enough to still be in the index in 2026. You could not have known
that list in 2007. Every screener that backtests on a current constituent list has this
flaw, and most do not disclose it.

### 2. "Beaten down stocks recover" underperformed just holding everything

Buying the 20 worst 12-month performers in the Nifty 200 and holding 12 months, vs
buying the 20 best, vs equal-weighting the universe (60bps round-trip costs):

| rule | mean ann. | median ann. | beats equal-weight |
|---|---|---|---|
| reversal (beaten down) | 31.2% | 16.0% | **38.7%** |
| momentum (winners) | 39.9% | 28.4% | 72.8% |
| equal-weight | 30.1% | 17.7% | — |

The reversal rule's *mean* looks fine, but its **median is below the baseline** and it
beats simply holding everything only 39% of the time. A high mean with a low median means
a handful of huge winners are carrying a mostly-losing strategy — and remember the dead
companies are missing from this data entirely, which flatters reversal most of all.

Momentum held up better, which matches NSE's own factor index research. Note this is the
*opposite* of the "buy what's fallen" instinct.

### 3. Even a strategy that works has brutal entry-timing dependence

NSE's own Nifty200 Momentum 30 index underperformed the Nifty 50 for roughly three years
(Jan 2017 – Mar 2020), and again through the Mar 2020 recovery. Two investors who entered
two months apart — March vs May 2021 — earned 18.3% vs 3.4% by May 2022. Same index, same
rules. Timing dominated everything.

### 5. The momentum evidence is thinner than it is usually sold

Nearly all of NSE's Nifty200 Momentum 30 outperformance is concentrated in a single
6-year window (2012-2018). Its parameters — 30 stocks, a 50/50 blend of 6m and 12m
z-scores, semi-annual rebalance, F&O-only eligibility — were plausibly chosen because
they maximised backtested returns. It underperformed the plain Nifty 50 for roughly
three years from 2018, again through the March 2020 recovery, and for ~3.5 years after
the 2008 crash. NSE strategy indices carry an April 2005 base date but almost no live
traded history before 2021.

### 6. Derivatives are where retail money actually dies

SEBI's study of roughly 10.7 million individual F&O traders (FY2018-FY2022) found about
**89% lost money**, with aggregate FY2022 losses near ₹75,000 crore. Figures are widely
reported; sebi.gov.in was unreachable during research, so treat them as strong but
second-hand. Nothing in this repo touches derivatives, deliberately.

### 4. What a 3x or 10x actually requires

| target | horizon | CAGR needed | historical hit rate (Sensex, 1997-2026) |
|---|---|---|---|
| 10x | 3y | 115.4% | 0% |
| 10x | 10y | 25.9% | 0% |
| 10x | 15y | 16.6% | 7% |
| 3x | 5y | 24.6% | 11% |
| 3x | 10y | 11.6% | **66%** |

The fastest the Sensex ever 10x'd — buying the exact bottom with perfect hindsight —
took **11.7 years**.



This does not, and will not without an explicit separate decision:

- place orders or connect to a broker
- store credentials
- generate buy/sell recommendations

Personalised investment advice in India requires SEBI RIA/RA registration. Automating
trades in *your own* account via a broker API is permitted, but retail algo rules
tightened in 2025 — brokers require strategy registration above certain order-rate
thresholds. Check your broker's algo policy before going anywhere near execution.

## Publishing it for free

The public site is **static files only**. There is no backend in production, which is the
whole reason it can be free at any traffic level: serving a million visitors is a CDN
problem, not a compute problem, and every major CDN gives that away.

```
pipeline.run()          # fetch, score, and write web/public/data/
scripts/verify_static.py  # refuse to publish a broken bundle
cd web && npm run build   # bundle the app + data into web/dist/
```

`web/dist/` is then the entire website. Upload it anywhere.

### What gets written

| File | Purpose |
| --- | --- |
| `data/screen.json` | The whole board, columnar (repeated JSON keys stripped) |
| `data/calendar.json` | Shared trading-day axis + the equal-weighted market line |
| `data/charts/SYMBOL.json` | Per-symbol history, fetched only when a stock is opened |
| `data/sources.json` | Source health recorded at build time |
| `data/manifest.json` | SHA-256 of every published file, plus the git commit |

Columnar encoding and rounding to displayed precision cut the board from **519 KB to
309 KB gzipped**, and per-symbol history from **19 KB to 9 KB**.

### Hosting

Deployed to **Cloudflare Pages** at `experiments.kousikdutta.com`, because its free tier
meters neither bandwidth nor requests, so traffic growth cannot generate a bill.

GitHub Pages was the original target and is the wrong one. A first visit is about 660 KB
gzipped — 286 KB of app, 374 KB of screen data — so the 100 GB/month soft cap works out
at roughly 5,000 visitors a day. GitHub enforces it by taking the site down rather than
by billing, which is the failure mode this project least wants.

Deploying needs two repository secrets: `CLOUDFLARE_API_TOKEN` (scoped to
*Cloudflare Pages: Edit*) and `CLOUDFLARE_ACCOUNT_ID`.

The Pages project must be **Direct Upload**, not connected to this repository. A
git-connected project builds the site on Cloudflare, and this site cannot be built from
the repository alone — the board's data is produced by the Python pipeline and
`web/public/data/` is gitignored, so a Cloudflare-side build yields an app shell with no
data in it. GitHub Actions runs the pipeline, builds, verifies, and uploads the result.

If a git-connected project already exists under this name, delete it before the first
deploy: Cloudflare refuses direct uploads to a project it builds itself.

`web/public/_headers` sets the cache policy Cloudflare/Netlify read: fingerprinted assets
are immutable, data files are edge-cached for minutes-to-hours with
`stale-while-revalidate`, and the HTML shell is never cached hard (otherwise visitors keep
booting an old bundle that points at deleted asset filenames).

### Staying current without a server

`.github/workflows/daily-refresh.yml` runs at 13:45 UTC (19:15 IST) on weekdays, after
NSE publishes the day's bhavcopy. It refetches only the missing days, rescores, verifies,
deploys, and then **commits the new sessions back to this repository**. If a run fails,
the previously deployed site keeps serving — visitors get slightly older data rather than
an outage.

Two files are committed rather than cached, deliberately. `actions/cache` is evicted
after seven days of no access, and NSE does not serve historical bhavcopy indefinitely,
so a session that is not captured on the day is gone permanently.

`data/shareholders.parquet` is committed for a related reason. The shareholding crawler
is intentionally slow — 150 companies per run against a universe of 1,600 — so a runner
starting from an empty cache would take a fortnight to populate the Investors page, and
might never converge if the cache is evicted first. The first CI run demonstrated it
exactly: 84 filers and zero portfolios. Parquet keeps 52,000 holder rows in 1.1 MB, so
the crawler resumes from a full table instead of from nothing.

Everything else under `data/` is regenerable and stays in the cache, where eviction costs
only time.

### The AI assistant costs nothing to run

The assistant calls Google directly from the visitor's browser using **their own** free
Gemini key, stored only in their `localStorage`. This is the one feature with a real
per-request cost, and routing it through a shared server key is what would eventually
force a paywall. There is no key on the operator's side and no server in the data path.

## Licence, and the honest limits of "uncopyable"

The source is public and the published data is hash-verifiable, because a research tool
nobody can audit is worth nothing. That transparency has a direct consequence worth
stating plainly: **anyone can read the code and download the data.** No technical measure
changes that for a public website, and obfuscation would only destroy the auditability
that is the point of the project.

What actually protects the work is not secrecy:

1. **The archive.** Delivery percentages, F&O bans, bulk/block deals and announcements are
   snapshotted daily. The exchanges do not sell that history back. A copy started today
   gets today onward and can never reconstruct the accumulated point-in-time record — and
   the gap widens every single day.
2. **The licence.** `LICENSE` is PolyForm Shield 1.0.0: read it, run it, modify it, learn
   from it — but you may not use it to build a competing product. Fully source-available,
   not a free pass to clone commercially.
3. **Provenance.** `data/manifest.json` records a SHA-256 for every published file
   alongside the git commit that produced it, so an authentic build can be verified and a
   scraped copy cannot credibly claim to be the same thing.
