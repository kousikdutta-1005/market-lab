/**
 * Data access layer that works with or without a backend.
 *
 * Production is a static CDN deploy: there is no server to call, so everything here
 * reads plain files that Cloudflare/GitHub can cache and serve for free at any traffic
 * level. When a local backend happens to be running (developer machine), the same code
 * transparently gains live refresh and live source probes.
 *
 * The rule is: static files are the source of truth, the API is an optional upgrade.
 * That ordering matters — if the API were tried first, every public visitor would pay a
 * failed request and a timeout before seeing any data.
 */
import type { Screen, SourceProbe, Stock, StockChartResponse, ChartPoint } from '../types';

export const API = import.meta.env.DEV ? 'http://localhost:8787' : '';
const BASE = import.meta.env.BASE_URL || '/';
const DATA = `${BASE.replace(/\/$/, '')}/data`;

/**
 * Whether it is worth asking for a pipeline backend at all.
 *
 * The local app serves a *production* build from a real FastAPI process, so checking
 * import.meta.env.DEV would wrongly disable refresh on the developer's own machine.
 * Host is the honest signal: only a local origin can have the pipeline behind it. A
 * public visitor therefore never pays a failed request, which at a million users a day
 * is a million pointless 404s avoided.
 */
export function canHaveBackend(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

type Columnar = { columns: string[]; rows: unknown[][] };

/** Rebuild objects from the columnar wire format. */
function decode<T>(block: Columnar | undefined): T[] {
  if (!block?.columns?.length) return [];
  const { columns, rows } = block;
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i += 1) obj[columns[i]] = row[i] ?? null;
    return obj as T;
  });
}

export async function loadScreen(): Promise<Screen> {
  const attempts = [
    `${DATA}/screen.json`,
    `${API}/api/screen`,
    `${BASE}screen.json`,
  ];
  let lastError = 'no data source responded';
  for (const url of attempts) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        lastError = `HTTP ${r.status}`;
        continue;
      }
      const raw = await r.json();
      // Columnar bundle (static build) vs the legacy row-of-objects file.
      if (raw?.format === 'columnar-v1') {
        return {
          ...raw.meta,
          stocks: decode<Stock>(raw.stocks),
          excluded: decode<Screen['excluded'][number]>(raw.excluded),
        } as Screen;
      }
      return raw as Screen;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastError);
}

/** Shared trading calendar + equal-weighted market line, fetched once per session. */
let calendarPromise: Promise<{ dates: string[]; market_return_pct: (number | null)[] }> | null = null;

function loadCalendar() {
  if (!calendarPromise) {
    calendarPromise = fetch(`${DATA}/calendar.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`calendar HTTP ${r.status}`);
        return r.json();
      })
      .catch((e) => {
        // Allow a later attempt to succeed rather than caching the failure forever.
        calendarPromise = null;
        throw e;
      });
  }
  return calendarPromise;
}

const RANGE_SESSIONS: Record<string, number> = { '3m': 66, '6m': 126, '1y': 252, '2y': 504 };

export async function loadChart(symbol: string, range: string): Promise<StockChartResponse> {
  const want = RANGE_SESSIONS[range] ?? 252;
  try {
    const [calendar, res] = await Promise.all([
      loadCalendar(),
      fetch(`${DATA}/charts/${encodeURIComponent(symbol)}.json`),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();

    const close: (number | null)[] = doc.close ?? [];
    const offset: number = doc.off ?? 0;
    const total = close.length;
    const start = Math.max(0, total - want);
    const base = close[start] ?? null;

    const points: ChartPoint[] = [];
    for (let i = start; i < total; i += 1) {
      const c = close[i];
      if (c == null) continue;
      const calIdx = offset + i;
      points.push({
        date: calendar.dates[calIdx] ?? '',
        close: c,
        return_pct: base ? Number((((c / base) - 1) * 100).toFixed(2)) : null,
        market_return_pct: calendar.market_return_pct[calIdx] ?? null,
        ma50: doc.ma50?.[i] ?? null,
        ma200: doc.ma200?.[i] ?? null,
        volume: doc.volume?.[i] ?? null,
        turnover: doc.turnover?.[i] ?? null,
      });
    }

    return {
      symbol,
      range,
      source: 'NSE bhavcopy (exchange EOD)',
      last_date: points.length ? points[points.length - 1].date : null,
      points,
    };
  } catch {
    // Static file missing (e.g. a dev machine that has not run an export yet) — fall
    // back to the local backend if one is listening.
    const r = await fetch(`${API}/api/chart/${encodeURIComponent(symbol)}?range=${range}`);
    if (!r.ok) throw new Error(`chart HTTP ${r.status}`);
    return (await r.json()) as StockChartResponse;
  }
}

export async function loadSources(): Promise<{ sources: SourceProbe[]; checked_at: string | null; live: boolean }> {
  // A live backend can actually probe the upstreams right now; a static deploy can only
  // report what the last pipeline run observed. Both are useful, but they must not be
  // presented as the same thing.
  if (canHaveBackend()) {
    try {
      const r = await fetch(`${API}/api/sources`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        return { sources: j.sources ?? [], checked_at: j.checked_at ?? null, live: true };
      }
    } catch {
      /* fall through to the static snapshot */
    }
  }
  const r = await fetch(`${DATA}/sources.json`);
  if (!r.ok) throw new Error(`sources HTTP ${r.status}`);
  const j = await r.json();
  return { sources: j.sources ?? [], checked_at: j.checked_at ?? null, live: false };
}

/** True when a local pipeline backend is reachable, enabling refresh controls. */
export async function probeBackend(): Promise<boolean> {
  if (!canHaveBackend()) return false;
  try {
    const r = await fetch(`${API}/api/status`, { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}
