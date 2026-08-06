import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Plug, RotateCw } from 'lucide-react';
import type { SourceProbe } from './types';

const API = import.meta.env.DEV ? 'http://localhost:8787' : '';

export function ApiHealth() {
  const [probes, setProbes] = useState<SourceProbe[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch(`${API}/api/sources`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setProbes(j.sources);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (failed) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
        <span className="flex items-center gap-2">
          <Plug className="size-4" />
          Source checks need the backend running. The screen below is served from disk and works
          without it.
        </span>
      </section>
    );
  }

  const ok = probes?.filter((p) => p.ok).length ?? 0;
  const total = probes?.length ?? 0;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center gap-3 border-b border-slate-800 p-4">
        <Plug className="size-4 text-slate-500" />
        <h2 className="text-sm font-medium text-slate-200">Data sources</h2>
        <span className="text-xs text-slate-500">
          {probes ? `${ok} of ${total} reachable` : 'checking…'}
        </span>
        <button
          onClick={check}
          disabled={checking}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200 disabled:opacity-50"
        >
          <RotateCw className={`size-3 ${checking ? 'animate-spin' : ''}`} />
          Re-check
        </button>
      </div>

      <div className="divide-y divide-slate-800/60">
        {!probes && (
          <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Probing endpoints…
          </div>
        )}
        {probes?.map((p) => (
          <div key={p.name} className="flex items-start gap-3 p-3">
            {p.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-slate-200">{p.name}</span>
                <span className="text-xs text-slate-500">{p.detail}</span>
                <span className="ml-auto text-xs tabular-nums text-slate-600">{p.ms} ms</span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{p.note}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
