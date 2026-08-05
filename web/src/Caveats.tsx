import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Info } from 'lucide-react';

const POINTS = [
  {
    title: 'This is a description, not a prediction',
    body: 'Every score below is a percentile rank of what a company measurably looks like today — profitability, growth already recorded, valuation multiples, where the price sits. None of it forecasts what happens next. A stock scoring 95 can fall tomorrow, and frequently does.',
  },
  {
    title: 'Survivorship bias inflated our own backtest by ~21 points a year',
    body: 'Backtesting on today\'s Nifty 200 constituents over 2007–2026 showed 30.1% annual returns for simply equal-weighting the universe. The Nifty actually returned 9.4%. The gap is entirely the arithmetic of only holding companies successful enough to still exist in 2026. Every screener has this problem; most do not mention it.',
  },
  {
    title: '"Beaten down stocks recover" lost to doing nothing, 61% of the time',
    body: 'Buying the 20 worst 12-month performers in the Nifty 200 and holding a year beat simply equal-weighting the whole universe in only 38.7% of windows, with a median below the baseline. Its respectable-looking average came from a handful of outliers — and the companies that never recovered are missing from the data entirely.',
  },
  {
    title: 'The momentum evidence is weaker than it is usually presented',
    body: 'Nearly the entire historical outperformance of NSE\'s Nifty200 Momentum 30 index is concentrated in one 6-year window, 2012–2018. Its parameters — 30 stocks, 6/12-month blend, semi-annual rebalance — were plausibly selected because they looked best in backtests. It underperformed the plain Nifty for roughly three years from 2018, and again through the 2020 recovery.',
  },
  {
    title: 'Entry date can matter more than the strategy',
    body: 'Two investors buying NSE\'s momentum index two months apart — March versus May 2021 — earned 18.3% and 3.4% respectively by May 2022. Same index, same rules, same holding period.',
  },
  {
    title: 'Derivatives are where retail money actually dies',
    body: 'SEBI\'s study of roughly 10.7 million individual F&O traders found about 89% lost money, with aggregate FY2022 losses near ₹75,000 crore. (Figures widely reported; we could not reach sebi.gov.in directly to verify first-hand.) Nothing in this tool relates to derivatives, and that is deliberate.',
  },
  {
    title: 'The data itself is imperfect',
    body: 'Fundamentals come from Yahoo Finance and are incomplete for some Indian tickers — the coverage figure on each row shows how much was actually available. Public NAV and price feeds carry bad rows; we found a literal 0.0 NAV in one fund\'s history that produced a fake −100% drawdown until filtered.',
  },
];

export function Caveats() {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <AlertTriangle className="size-5 shrink-0 text-amber-400" />
        <div className="flex-1">
          <h2 className="font-semibold text-amber-200">Read this before using any number below</h2>
          <p className="text-sm text-amber-200/60">
            Seven things that determine whether this tool helps you or costs you money.
          </p>
        </div>
        {open ? (
          <ChevronUp className="size-5 text-amber-400/70" />
        ) : (
          <ChevronDown className="size-5 text-amber-400/70" />
        )}
      </button>

      {open && (
        <div className="grid gap-4 border-t border-amber-500/20 px-5 py-4 md:grid-cols-2">
          {POINTS.map((p) => (
            <div key={p.title} className="flex gap-3">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-400/70" />
              <div>
                <h3 className="text-sm font-medium text-amber-100">{p.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{p.body}</p>
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500 md:col-span-2">
            Not investment advice. Not SEBI-registered. Personalised buy/sell recommendations in
            India legally require SEBI RIA/RA registration. This tool deliberately produces scores
            you can audit rather than calls you must trust.
          </p>
        </div>
      )}
    </section>
  );
}
