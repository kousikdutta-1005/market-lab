import { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, AlertTriangle, Check, Clock, Radio, ChevronDown, ChevronUp, CalendarClock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Screen, Status } from './types';
import { formatAge } from './types';
import { API, canHaveBackend } from '@/lib/dataSource';
import { marketPhase } from '@/lib/marketPhase';

/**
 * How often the UI re-reads *local backend* state. This poll only happens on a developer
 * machine; the public static site never issues it, so it costs the deploy nothing.
 */
const POLL_MS = 5000;

interface Props {
  onDataChanged: () => void;
  screen: Screen | null;
}

function ageSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 1000;
}

export default function LiveStatus({ onDataChanged, screen }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  // "No backend" is the normal, expected state for every public visitor. It is a mode,
  // not an error, and presenting it as a warning made a healthy site look broken.
  const [hasBackend, setHasBackend] = useState<boolean | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [, setTick] = useState(0);
  const lastGenerated = useRef<string | null>(null);

  const poll = useCallback(async () => {
    // Only a local origin can have the pipeline behind it. On the public static build
    // this request would 404 for every visitor forever, so it is never issued.
    if (!canHaveBackend()) {
      setHasBackend(false);
      return;
    }
    try {
      const r = await fetch(`${API}/api/status`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const s: Status = await r.json();
      setStatus(s);
      setHasBackend(true);

      const gen = s.data?.generated_at ?? null;
      if (gen && lastGenerated.current && gen !== lastGenerated.current) onDataChanged();
      if (gen) lastGenerated.current = gen;
    } catch {
      setHasBackend(false);
    }
  }, [onDataChanged]);

  useEffect(() => {
    poll();
  }, [poll]);

  useEffect(() => {
    // Only keep polling where a backend actually exists. On the public site this
    // interval would be a pointless failing request every 5s, forever, per visitor.
    if (hasBackend !== true) {
      // Still re-render on a slow tick so the market phase clock stays honest.
      const id = setInterval(() => setTick((t) => t + 1), 60_000);
      return () => clearInterval(id);
    }
    const id = setInterval(() => {
      poll();
      setTick((t) => t + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [hasBackend, poll]);

  const refresh = async () => {
    try {
      await fetch(`${API}/api/refresh`, { method: 'POST' });
      poll();
    } catch {
      setHasBackend(false);
    }
  };

  const job = status?.job;
  const running = job?.running ?? false;
  const phase = marketPhase();
  const staticMode = hasBackend === false;

  const session = status?.data?.last_trading_session ?? screen?.last_trading_session ?? '—';
  const age = staticMode ? ageSeconds(screen?.generated_at) : status?.data?.age_s;
  const phaseColor = phase.isOpen ? 'text-success' : 'text-muted-foreground';

  return (
    <Card>
      <CardContent>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${phaseColor} ${phase.isOpen ? 'animate-pulse' : ''}`} />
            <span className="text-sm font-semibold text-foreground">Market {phase.phase}</span>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              Close of <span className="font-medium text-foreground">{session}</span>
              {/* Users kept asking why "today" was missing. It is not missing: NSE simply
                  has not published it yet. Say that plainly instead of leaving a gap. */}
              {phase.awaitingToday && <span> · today&rsquo;s close publishes ~18:30 IST</span>}
              {age != null && <span> · built {formatAge(age)}</span>}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {staticMode ? (
              <Badge variant="outline" title="This site is served as static files from a CDN and is rebuilt after every trading session.">
                <CalendarClock className="h-3 w-3" />
                auto-updates daily
              </Badge>
            ) : (
              <Button onClick={refresh} disabled={running}>
                <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
                {running ? 'Refreshing…' : 'Refresh data'}
              </Button>
            )}
          </div>
        </div>

        {running && (
          <div className="mt-3 rounded-lg border bg-muted p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground">{job?.stage}</span>
              <span className="text-muted-foreground">{job?.elapsed_s ?? 0}s</span>
            </div>
          </div>
        )}

        {!running && job?.error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div>
              <p className="text-destructive">Refresh failed</p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{job.error}</p>
            </div>
          </div>
        )}

        {!running && !job?.error && job?.stage === 'done' && (
          <div className="mt-3 flex items-center gap-2 text-sm font-medium text-success">
            <Check className="h-4 w-4" />
            Refresh complete
          </div>
        )}

        {/* The honest part: say what actually updates, and how often. */}
        <div className="mt-3 border-t pt-3">
          <Button
            onClick={() => setShowLog((v) => !v)}
            variant="ghost"
            size="sm"
            className="h-7 px-0 text-muted-foreground"
          >
            {showLog ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            What refreshes, and how often
          </Button>
          {showLog && (
            <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
              {staticMode ? (
                <p>
                  This site is a set of pre-built files on a CDN. There is no server to overload
                  and nothing to pay for, which is why it can stay free. The data is rebuilt
                  automatically after each trading session and the page picks it up on your next
                  visit.
                </p>
              ) : (
                <p>
                  A local backend is running, so the Refresh button really does re-run the
                  pipeline. The display re-reads server state every {POLL_MS / 1000} seconds.
                </p>
              )}
              <p>The underlying market data does not change faster than its sources do:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  <span className="font-medium text-foreground">Prices</span> — NSE publishes one
                  bhavcopy per trading day, around {phase.newDataExpected ?? '18:30 IST'}. There is
                  no new official closing data before then.
                </li>
                <li>
                  <span className="font-medium text-foreground">Fundamentals</span> — change when
                  companies file results, so roughly quarterly.
                </li>
                <li>
                  <span className="font-medium text-foreground">Official events/news</span> —
                  NSE/BSE corporate announcements are refetched on every rebuild.
                </li>
                <li>
                  <span className="font-medium text-foreground">Scores</span> — fundamentals,
                  technicals, liquidity, event scores and horizon rankings are all recomputed on
                  every rebuild.
                </li>
              </ul>
              <p>
                Stock prices are official NSE end-of-day values, not live ticks. Free whole-market
                live quote endpoints are blocked or unauthorised, and the board says so rather than
                implying it is real-time.
              </p>
              {job?.log && job.log.length > 0 && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] text-muted-foreground">
                  {job.log.join('\n')}
                </pre>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
