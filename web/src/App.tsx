import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Database, Layers, Loader2, Filter, EyeOff } from 'lucide-react';
import { ApiHealth } from './ApiHealth';
import { Caveats } from './Caveats';
import LiveStatus from './LiveStatus';
import { StockDetail } from './StockDetail';
import { StockTable } from './StockTable';
import type { Screen, SizeBucket, RatingBasis, HorizonKey } from './types';
import { BUCKETS, BUCKET_LABEL, BUCKET_HELP, HORIZONS } from './types';

const API = import.meta.env.DEV ? 'http://localhost:8787' : '';

function Stat({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <Icon className="size-4 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="truncate text-sm font-medium text-slate-200">{value}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Set<SizeBucket>>(new Set(BUCKETS));
  const [basis, setBasis] = useState<'all' | RatingBasis>('all');
  const [horizon, setHorizon] = useState<HorizonKey>('medium');
  const [minFit, setMinFit] = useState(0);
  const [fundamentalFilter, setFundamentalFilter] = useState('all');
  const [technicalFilter, setTechnicalFilter] = useState('all');
  const [newsFilter, setNewsFilter] = useState('all');
  const [liquidityFloor, setLiquidityFloor] = useState(0);
  const [showExcluded, setShowExcluded] = useState(false);
  const horizonMeta = HORIZONS.find((h) => h.key === horizon) ?? HORIZONS[1];

  const load = useCallback(async () => {
    try {
      let r = await fetch(`${API}/api/screen`, { cache: 'no-store' });
      if (!r.ok) r = await fetch(`${import.meta.env.BASE_URL}screen.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setScreen(await r.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleBucket = (b: SizeBucket) => {
    setBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next.size ? next : new Set(BUCKETS);
    });
  };

  const visible = useMemo(() => {
    if (!screen) return [];
    return screen.stocks.filter((s) => {
      if (s.bucket && !buckets.has(s.bucket)) return false;
      if (basis !== 'all' && s.rating_basis !== basis) return false;
      const fit = s[horizonMeta.scoreKey] ?? 0;
      if (fit < minFit) return false;
      if (liquidityFloor > 0 && (s.turnover_median ?? 0) < liquidityFloor) return false;
      if (fundamentalFilter === 'quality-growth' && ((s.quality ?? 0) < 60 || (s.growth ?? 0) < 60)) return false;
      if (fundamentalFilter === 'quality-value' && ((s.quality ?? 0) < 60 || (s.valuation ?? 0) < 60)) return false;
      if (fundamentalFilter === 'clean-balance-sheet' && ((s.quality ?? 0) < 60 || (s.debt_to_equity ?? 99) > 1.5)) return false;
      if (technicalFilter === 'uptrend' && ((s.trend ?? 0) < 60 || (s.momentum ?? 0) < 50)) return false;
      if (technicalFilter === 'momentum' && (s.momentum ?? 0) < 70) return false;
      if (newsFilter === 'recent' && (s.news_count_14d ?? 0) === 0) return false;
      if (newsFilter === 'constructive' && (s.news_event_score ?? 0) < 60) return false;
      if (newsFilter === 'no-risk' && (s.news_negative_14d ?? 0) > 0) return false;
      return true;
    });
  }, [screen, buckets, basis, horizonMeta.scoreKey, minFit, liquidityFloor, fundamentalFilter, technicalFilter, newsFilter]);

  if (error && !screen) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 p-8 text-center">
        <div>
          <p className="text-rose-400">Could not load the screen — {error}</p>
          <p className="mt-2 text-sm text-slate-500">
            Run <code className="rounded bg-slate-800 px-1.5 py-0.5">./run.sh</code> from the project
            root, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (!screen) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950">
        <Loader2 className="size-6 animate-spin text-slate-600" />
      </div>
    );
  }

  const stock = screen.stocks.find((s) => s.symbol === selected) ?? null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      <div className="mx-auto max-w-[1600px] space-y-5 p-6">
        <header>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
            <BarChart3 className="size-6 text-teal-400" />
            market-lab
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            A transparent factor rating for the whole NSE-listed market. Every score is a percentile
            rank of published, auditable metrics — never a prediction or a recommendation.
          </p>
        </header>

        <LiveStatus onDataChanged={load} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={Layers}
            label="Universe"
            value={`${screen.scored.toLocaleString('en-IN')} scored of ${screen.universe_total.toLocaleString('en-IN')} listed`}
          />
          <Stat icon={CalendarDays} label="Last session" value={screen.last_trading_session} />
          <Stat
            icon={Database}
            label="Price layer"
            value={screen.live_quote_status === 'available' ? `${screen.live_quote_source} · live` : 'NSE EOD bhavcopy'}
          />
          <Stat
            icon={BarChart3}
            label="Official events"
            value={`${screen.news_symbols.toLocaleString('en-IN')} symbols · ${screen.news_status}`}
          />
        </div>

        <ApiHealth />

        {/* Ranks are computed WITHIN size bucket, so filtering changes what you see
            but never re-ranks — a percentile is always against the stock's own peers. */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Filter className="size-4" />
              Size
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BUCKETS.map((b) => {
                const n = screen.stocks.filter((s) => s.bucket === b).length;
                const on = buckets.has(b);
                return (
                  <button
                    key={b}
                    onClick={() => toggleBucket(b)}
                    title={BUCKET_HELP[b]}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      on
                        ? 'bg-teal-600/20 text-teal-200 ring-1 ring-teal-500/40'
                        : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {BUCKET_LABEL[b]} <span className="opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(['all', 'fundamental + technical', 'technical only'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBasis(b)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    basis === b
                      ? 'bg-slate-700 text-slate-100'
                      : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {b === 'all' ? 'Any basis' : b}
                </button>
              ))}
            </div>

            <span className="ml-auto text-xs text-slate-500">
              {visible.length.toLocaleString('en-IN')} shown
            </span>
          </div>

          <p className="mt-3 border-t border-slate-800 pt-3 text-xs leading-relaxed text-slate-500">
            Percentile ranks are computed{' '}
            <span className="text-slate-300">within each size bucket</span>, not across the whole
            market. A nano-cap's valuation percentile measured against Reliance would mostly be
            measuring company size and calling it value. Filtering changes what is listed here; it
            never re-ranks anything.
          </p>
        </section>

        <section className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-teal-100">
                <BarChart3 className="size-4" />
                Research fit, not a recommendation
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
                Horizon scores combine fundamentals, technicals, liquidity and official NSE corporate
                announcements. They rank what looks investable for a style and time horizon; they are
                not a buy/sell call and they do not know your risk, cash needs or position size.
              </p>
            </div>

            <div className="ml-auto flex flex-wrap gap-1.5">
              {HORIZONS.map((h) => (
                <button
                  key={h.key}
                  onClick={() => setHorizon(h.key)}
                  title={h.detail}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    horizon === h.key
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Minimum fit</span>
              <select
                value={minFit}
                onChange={(e) => setMinFit(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300 outline-none focus:border-slate-500"
              >
                <option value={0}>Any score</option>
                <option value={60}>60+</option>
                <option value={75}>75+</option>
                <option value={90}>90+</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Fundamentals</span>
              <select
                value={fundamentalFilter}
                onChange={(e) => setFundamentalFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300 outline-none focus:border-slate-500"
              >
                <option value="all">Any</option>
                <option value="quality-growth">Quality + growth 60+</option>
                <option value="quality-value">Quality + value 60+</option>
                <option value="clean-balance-sheet">Quality 60+ and D/E ≤ 1.5</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Technicals</span>
              <select
                value={technicalFilter}
                onChange={(e) => setTechnicalFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300 outline-none focus:border-slate-500"
              >
                <option value="all">Any</option>
                <option value="uptrend">Trend 60+ and momentum 50+</option>
                <option value="momentum">Momentum 70+</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Official events</span>
              <select
                value={newsFilter}
                onChange={(e) => setNewsFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300 outline-none focus:border-slate-500"
              >
                <option value="all">Any</option>
                <option value="recent">Has NSE event in 14d</option>
                <option value="constructive">Event score 60+</option>
                <option value="no-risk">No risk event in 14d</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Liquidity</span>
              <select
                value={liquidityFloor}
                onChange={(e) => setLiquidityFloor(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300 outline-none focus:border-slate-500"
              >
                <option value={0}>Any tradeable</option>
                <option value={10000000}>₹1 cr/day+</option>
                <option value={100000000}>₹10 cr/day+</option>
                <option value={1000000000}>₹100 cr/day+</option>
              </select>
            </label>
          </div>

          <p className="mt-3 border-t border-teal-500/15 pt-3 text-xs leading-relaxed text-slate-500">
            Current ranking column: <span className="text-slate-300">{horizonMeta.label}</span> — {horizonMeta.detail}.
            Pressing Refresh rebuilds prices, technicals, liquidity, official events and all horizon scores, then the board
            reloads from the newly written JSON.
            {screen.live_quote_status !== 'available' && (
              <>
                {' '}Live stock quotes are not overlaid right now: <span className="text-slate-400">{screen.live_quote_detail}</span>
              </>
            )}
          </p>
        </section>

        <Caveats />

        <div className={`grid gap-5 ${stock ? 'xl:grid-cols-[minmax(0,1fr)_minmax(540px,640px)]' : ''}`}>
          <StockTable stocks={visible} selected={selected} onSelect={setSelected} rankingKey={horizonMeta.scoreKey} />
          {stock && <StockDetail stock={stock} screen={screen} onClose={() => setSelected(null)} />}
        </div>

        {/* Excluded stocks are shown, not hidden: a screen that quietly deletes part of
            the market teaches you the wrong thing about what is out there. */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40">
          <button
            onClick={() => setShowExcluded((v) => !v)}
            className="flex w-full items-center gap-2 p-4 text-left text-sm text-slate-400 transition hover:text-slate-200"
          >
            <EyeOff className="size-4" />
            {screen.excluded.length.toLocaleString('en-IN')} stocks excluded from scoring — see why
          </button>
          {showExcluded && (
            <div className="max-h-80 overflow-auto border-t border-slate-800 px-4 pb-4">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900 text-left text-slate-500">
                  <tr>
                    <th className="py-2 font-medium">Symbol</th>
                    <th className="py-2 font-medium">Size</th>
                    <th className="py-2 text-right font-medium">Sessions</th>
                    <th className="py-2 font-medium">Tradeable?</th>
                    <th className="py-2 font-medium">Reasons</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {screen.excluded.map((e) => (
                    <tr key={e.symbol}>
                      <td className="py-1.5 font-mono text-slate-300">{e.symbol}</td>
                      <td className="py-1.5 text-slate-500">{e.bucket ?? '—'}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">
                        {e.sessions ?? '—'}
                      </td>
                      <td className="py-1.5">
                        {e.tradeable ? (
                          <span className="text-emerald-400">yes</span>
                        ) : (
                          <span className="text-slate-600">no</span>
                        )}
                      </td>
                      <td className="py-1.5 text-slate-500">{e.reasons.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="pb-4 text-xs leading-relaxed text-slate-600">
          Generated {new Date(screen.generated_at).toLocaleString('en-IN')} · {screen.source} ·{' '}
          {screen.sessions} sessions. For research and education only. Not investment advice, not
          SEBI-registered. Weights in{' '}
          <code className="rounded bg-slate-900 px-1 py-0.5">marketlab/rating.py</code> are deliberate
          round numbers — tuning them against past returns is how backtests become fiction.
        </footer>
      </div>
    </div>
  );
}
