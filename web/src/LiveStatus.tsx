import { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Circle, AlertTriangle, Check, Clock, Radio, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { Status } from './types';
import { formatAge } from './types';

const API = import.meta.env.DEV ? 'http://localhost:8787' : '';

/** How often the UI re-reads server state. Cheap: /api/status touches nothing external. */
const POLL_MS = 5000;

interface Props {
  onDataChanged: () => void;
}

export default function LiveStatus({ onDataChanged }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [tick, setTick] = useState(0);
  const lastGenerated = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/status`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const s: Status = await r.json();
      setStatus(s);
      setOffline(false);

      const gen = s.data?.generated_at ?? null;
      if (gen && lastGenerated.current && gen !== lastGenerated.current) onDataChanged();
      if (gen) lastGenerated.current = gen;
    } catch {
      setOffline(true);
    }
  }, [onDataChanged]);

  useEffect(() => {
    poll();
    const id = setInterval(() => {
      poll();
      setTick((t) => t + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const refresh = async () => {
    try {
      await fetch(`${API}/api/refresh`, { method: 'POST' });
      poll();
    } catch {
      setOffline(true);
    }
  };

  const job = status?.job;
  const running = job?.running ?? false;
  const market = status?.market;

  if (offline) {
    return (
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-sm">
            <p className="font-medium text-amber-200">Backend not reachable — showing the last saved data</p>
            <p className="mt-1 text-slate-400">
              The table below still works; it was written to disk by the last refresh. To enable
              refreshing, start the backend with{' '}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">./run.sh</code>.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const phaseColor = market?.is_open ? 'text-emerald-400' : 'text-slate-400';

  return (
    <section className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Radio className={`h-4 w-4 ${phaseColor} ${market?.is_open ? 'animate-pulse' : ''}`} />
          <span className="text-sm font-medium text-slate-200">Market {market?.phase ?? '—'}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock className="h-4 w-4" />
          <span>
            Data from session{' '}
            <span className="text-slate-200">{status?.data?.last_trading_session ?? '—'}</span>
            {status?.data?.age_s !== undefined && (
              <span className="text-slate-500"> · built {formatAge(status.data.age_s)}</span>
            )}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-500" title={`UI re-reads server state every ${POLL_MS / 1000}s`}>
            <Circle className={`h-2 w-2 fill-current ${tick % 2 ? 'text-emerald-500' : 'text-emerald-700'}`} />
            live · {POLL_MS / 1000}s
          </span>
          <button
            onClick={refresh}
            disabled={running}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
            {running ? 'Refreshing…' : 'Refresh data'}
          </button>
        </div>
      </div>

      {running && (
        <div className="mt-3 rounded-lg border border-teal-500/20 bg-teal-500/5 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-teal-200">{job?.stage}</span>
            <span className="text-slate-500">{job?.elapsed_s ?? 0}s</span>
          </div>
        </div>
      )}

      {!running && job?.error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div>
            <p className="text-rose-200">Refresh failed</p>
            <p className="mt-0.5 font-mono text-xs text-slate-400">{job.error}</p>
          </div>
        </div>
      )}

      {!running && !job?.error && job?.stage === 'done' && (
        <div className="mt-3 flex items-center gap-2 text-sm text-emerald-300">
          <Check className="h-4 w-4" />
          Refresh complete
        </div>
      )}

      {/* The honest part: say what actually updates, and how often. */}
      <div className="mt-3 border-t border-slate-800 pt-3">
        <button
          onClick={() => setShowLog((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-slate-300"
        >
          {showLog ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          What refreshes, and how often
        </button>
        {showLog && (
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-slate-400">
            <p>
              This panel re-reads server state every {POLL_MS / 1000} seconds, so the display is
              always current. The underlying market data is not, because it does not change that
              fast:
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <span className="text-slate-300">Prices</span> — NSE publishes one bhavcopy per
                trading day, around {market?.new_data_expected ?? '18:30 IST'}. There is no new
                official closing data before then, whatever the refresh button does.
              </li>
              <li>
                <span className="text-slate-300">Fundamentals</span> — change when companies file
                results, so roughly quarterly.
              </li>
              <li>
                <span className="text-slate-300">Official events/news</span> — NSE corporate
                announcements are fetched on refresh and included in the horizon scores.
              </li>
              <li>
                <span className="text-slate-300">Scores</span> — fundamentals, technicals,
                liquidity, event scores and horizon rankings are all recomputed on refresh.
              </li>
            </ul>
            <p>
              Live stock quotes are a separate layer. If a quote endpoint is reachable, it can be
              overlaid; right now the free whole-market quote endpoints are blocked or unauthorized,
              so the board uses NSE's EOD bhavcopy for stock prices and says so.
            </p>
            {job?.log && job.log.length > 0 && (
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-950/60 p-2 font-mono text-[11px] text-slate-400">
                {job.log.join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
