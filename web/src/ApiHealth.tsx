import { useEffect, useState } from 'react';
import { CheckCircle2, Plug, RefreshCw, XCircle } from 'lucide-react';

interface Source {
  name: string;
  purpose: string;
  auth: string;
  status: 'ok' | 'down';
  detail: string;
  latency_ms: number;
}

interface Health {
  checked_at: string;
  up: number;
  total: number;
  sources: Source[];
}

function latencyTone(ms: number) {
  if (ms < 1000) return 'text-slate-500';
  if (ms < 5000) return 'text-amber-400';
  return 'text-orange-400';
}

export function ApiHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}health.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setHealth)
      .catch(() => setMissing(true));
  }, []);

  if (missing) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Plug className="size-4 text-slate-500" />
          No health data yet — run{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">python check_health.py</code>
        </div>
      </section>
    );
  }

  if (!health) return null;

  const allUp = health.up === health.total;
  const stale = Date.now() - new Date(health.checked_at).getTime() > 6 * 3600 * 1000;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-3">
        <Plug className={`size-4 ${allUp ? 'text-emerald-400' : 'text-rose-400'}`} />
        <h2 className="text-sm font-medium text-slate-200">Data source connectivity</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            allUp ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
          }`}
        >
          {health.up}/{health.total} connected
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
          <RefreshCw className={`size-3 ${stale ? 'text-amber-400' : ''}`} />
          checked {new Date(health.checked_at).toLocaleString('en-IN')}
          {stale && <span className="text-amber-400">· stale</span>}
        </span>
      </header>

      <div className="divide-y divide-slate-800/60">
        {health.sources.map((s) => (
          <div key={s.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            {s.status === 'ok' ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="size-4 shrink-0 text-rose-400" />
            )}
            <span className="w-36 shrink-0 text-sm font-medium text-slate-200">{s.name}</span>
            <span className="w-64 shrink-0 text-xs text-slate-500">{s.purpose}</span>
            <span
              className={`flex-1 min-w-40 truncate font-mono text-xs ${
                s.status === 'ok' ? 'text-slate-400' : 'text-rose-300'
              }`}
              title={s.detail}
            >
              {s.detail}
            </span>
            <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-xs text-slate-500">
              {s.auth === 'none' ? 'no key' : s.auth}
            </span>
            <span className={`w-16 text-right text-xs tabular-nums ${latencyTone(s.latency_ms)}`}>
              {s.latency_ms}ms
            </span>
          </div>
        ))}
      </div>

      <p className="border-t border-slate-800 px-4 py-2.5 text-xs leading-relaxed text-slate-500">
        Each check validates response <em>shape</em>, not just HTTP status — a 200 returning an
        error page or an empty series is reported as down. Every source is public and keyless; no
        broker is connected and this tool cannot place orders.
      </p>
    </section>
  );
}
