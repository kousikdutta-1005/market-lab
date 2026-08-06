import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Database, Layers, Loader2, Filter, EyeOff } from 'lucide-react';
import { ApiHealth } from './ApiHealth';
import { Caveats } from './Caveats';
import LiveStatus from './LiveStatus';
import { StockDetail } from './StockDetail';
import { StockTable } from './StockTable';
import type { Screen, SizeBucket, RatingBasis } from './types';
import { BUCKETS, BUCKET_LABEL, BUCKET_HELP } from './types';

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
  const [showExcluded, setShowExcluded] = useState(false);

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
      return true;
    });
  }, [screen, buckets, basis]);

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
          <Stat icon={Database} label="Price source" value={screen.source} />
          <Stat
            icon={BarChart3}
            label="Rating basis"
            value={`${screen.rated_full} full · ${screen.rated_technical} technical-only`}
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

        <Caveats />

        <div className={`grid gap-5 ${stock ? 'xl:grid-cols-[minmax(0,1fr)_minmax(540px,640px)]' : ''}`}>
          <StockTable stocks={visible} selected={selected} onSelect={setSelected} />
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
