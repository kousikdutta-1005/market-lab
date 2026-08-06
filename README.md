# market-lab

Read-only research toolkit for Indian mutual funds and equities.

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
./run.sh              # serve the existing build and open the browser (works offline)
./run.sh --refresh    # re-fetch market data, rebuild, then serve (needs internet)
./run.sh --port 5180  # use a different port
```

Verified fully offline: 200 rows render with **zero external network requests** at runtime.
All market data is baked into static JSON at build time, so the app itself never calls out.

Deliberately local-only — there is no deploy step and no public URL. Publishing stock
ratings publicly in India edges toward regulated investment-advice territory; running it
on your own machine for your own research does not.

React 19 + Vite + Tailwind 4 + lucide-react + recharts. Sortable factor table across the
Nifty 200, click any row for a full breakdown: pillar radar, every raw metric, and any data
quality flags that caused a value to be suppressed.

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
