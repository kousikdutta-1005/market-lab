import { useEffect, useState } from 'react';
import { BarChart3, CalendarDays, Database, Layers, Loader2 } from 'lucide-react';
import { Caveats } from './Caveats';
import { StockDetail } from './StockDetail';
import { StockTable } from './StockTable';
import type { Screen } from './types';

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

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}screen.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setScreen)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 p-8 text-center">
        <div>
          <p className="text-rose-400">Could not load screen.json — {error}</p>
          <p className="mt-2 text-sm text-slate-500">
            Run <code className="rounded bg-slate-800 px-1.5 py-0.5">./.venv/bin/python build_screen.py</code> from the
            project root, then reload.
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

  const stock = screen.stocks.find((s) => s.ticker === selected) ?? null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      <div className="mx-auto max-w-7xl space-y-5 p-6">
        <header>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
            <BarChart3 className="size-6 text-teal-400" />
            market-lab
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            A transparent factor rating for Indian equities. Every score is a percentile rank of
            published, auditable metrics — never a prediction or a recommendation.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Layers} label="Universe" value={`${screen.n_scored} of ${screen.n_universe} scored`} />
          <Stat icon={CalendarDays} label="Prices as of" value={screen.as_of} />
          <Stat icon={Database} label="Sources" value="NSE archives · Yahoo Finance" />
          <Stat
            icon={BarChart3}
            label="Weighting"
            value={Object.entries(screen.weights)
              .map(([k, v]) => `${k.slice(0, 4)} ${(v * 100).toFixed(0)}%`)
              .join(' · ')}
          />
        </div>

        <Caveats />

        <div className={`grid gap-5 ${stock ? 'lg:grid-cols-[1.6fr_1fr]' : ''}`}>
          <StockTable stocks={screen.stocks} selected={selected} onSelect={setSelected} />
          {stock && <StockDetail stock={stock} screen={screen} onClose={() => setSelected(null)} />}
        </div>

        <footer className="pb-4 text-xs leading-relaxed text-slate-600">
          Generated {new Date(screen.generated_at).toLocaleString('en-IN')} · {screen.universe}. For
          research and education only. Not investment advice, not SEBI-registered. Weights in{' '}
          <code className="rounded bg-slate-900 px-1 py-0.5">marketlab/rating.py</code> are deliberate
          round numbers — tuning them against past returns is how backtests become fiction.
        </footer>
      </div>
    </div>
  );
}
