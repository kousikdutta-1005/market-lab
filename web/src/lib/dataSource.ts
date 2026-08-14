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

/**
 * Always same-origin. In dev, Vite proxies /api to the local pipeline backend, so this
 * needs no absolute URL and no CORS. Pointing dev at http://localhost:8787 directly used
 * to make every call cross-origin, and it broke outright whenever Vite moved to a
 * different port than the backend's allowlist expected.
 */
export const API = '';
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
function decode<T>(block: Columnar | undefined): { rows: T[]; rejected: number } {
  if (!block || !Array.isArray(block.columns) || !Array.isArray(block.rows)) {
    throw new Error('The published dataset has an invalid columnar structure.');
  }
  if (!block.columns.length) return { rows: [], rejected: 0 };
  if (block.columns.some((column) => typeof column !== 'string') || new Set(block.columns).size !== block.columns.length) {
    throw new Error('The published dataset has invalid column names.');
  }
  const { columns, rows } = block;
  const decoded = rows.filter(Array.isArray).map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i += 1) obj[columns[i]] = row[i] ?? null;
    return obj as T;
  });
  return { rows: decoded, rejected: rows.length - decoded.length };
}

const SIZE_BUCKETS = new Set(['large', 'mid', 'small', 'micro', 'nano']);
const RATING_BASES = new Set(['fundamental + technical', 'technical only', 'not rated']);
const HORIZONS = new Set(['short', 'medium', 'long']);
const RISK_LEVELS = new Set(['Low', 'Watch', 'High']);
const NUMERIC_STOCK_FIELDS = new Set([
  'price', 'market_cap', 'composite', 'composite_raw', 'coverage', 'pillars_used',
  'investable_score', 'short_fit', 'medium_fit', 'long_fit', 'liquidity_score',
  'news_event_score', 'news_count_14d', 'news_positive_14d', 'news_negative_14d',
  'deal_activity_score', 'deal_count', 'bulk_deal_count', 'block_deal_count',
  'short_deal_count', 'deal_value', 'bulk_deal_value', 'block_deal_value',
  'deal_net_qty', 'delivery_accumulation_score', 'delivery_pct_latest',
  'delivery_pct_median_20d', 'delivery_value_median_20d', 'delivery_spike',
  'high_delivery_days_20d', 'risk_score', 'opportunity_score', 'sast_events_180d',
  'sast_acquisitions', 'sast_disposals', 'sast_net_shares', 'sast_latest_stake',
  'turnover_median', 'trades_median', 'sessions', 'quality', 'growth', 'valuation',
  'trend', 'momentum', 'ret_6m', 'ret_12m', 'ann_vol', 'years_of_data', 'roe',
  'roa', 'operating_margin', 'net_margin', 'debt_to_equity', 'revenue_cagr',
  'earnings_cagr', 'pe', 'pb', 'ev_ebitda', 'dividend_yield', 'above_50dma',
  'above_200dma', 'dist_52w_high', 'mom_6m_risk_adj', 'mom_12m_risk_adj',
  'rs_vs_nifty',
]);

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  const number = finiteNumber(value);
  return number == null ? 0 : Math.max(0, Math.round(number));
}

function normaliseStock(value: unknown): { stock: Stock | null; incomplete: boolean } {
  if (!value || typeof value !== 'object') return { stock: null, incomplete: false };
  const raw = value as Record<string, unknown>;
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  if (!symbol || symbol.length > 32) return { stock: null, incomplete: false };

  const stock: Record<string, unknown> = { ...raw, symbol };
  for (const field of NUMERIC_STOCK_FIELDS) stock[field] = finiteNumber(raw[field]);
  stock.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  stock.sector = typeof raw.sector === 'string' && raw.sector.trim() ? raw.sector.trim() : null;
  stock.bucket = typeof raw.bucket === 'string' && SIZE_BUCKETS.has(raw.bucket) ? raw.bucket : null;
  stock.rating_basis =
    typeof raw.rating_basis === 'string' && RATING_BASES.has(raw.rating_basis) ? raw.rating_basis : 'not rated';
  stock.best_horizon =
    typeof raw.best_horizon === 'string' && HORIZONS.has(raw.best_horizon) ? raw.best_horizon : null;
  stock.risk_level =
    typeof raw.risk_level === 'string' && RISK_LEVELS.has(raw.risk_level) ? raw.risk_level : null;
  stock.fno_ban = typeof raw.fno_ban === 'boolean' ? raw.fno_ban : null;

  const bestFit =
    stock.best_horizon === 'short'
      ? stock.short_fit
      : stock.best_horizon === 'long'
        ? stock.long_fit
        : stock.best_horizon === 'medium'
          ? stock.medium_fit
          : null;
  const missingContext = [
    stock.risk_level == null ? 'risk' : null,
    stock.turnover_median == null ? 'liquidity' : null,
    stock.best_horizon == null || bestFit == null ? 'horizon' : null,
  ].filter((item): item is string => item != null);
  const incomplete = missingContext.length > 0;
  if (incomplete) {
    // A ranked idea without its downside, tradeability, or time context is not a ranked
    // idea. Keep the row visible for audit, but suppress decision-shaped scores.
    stock.opportunity_score = null;
    stock.investable_score = null;
    const existingFlags = typeof raw.data_flags === 'string' ? raw.data_flags.split(',').filter(Boolean) : [];
    stock.data_flags = [...new Set([...existingFlags, `missing_${missingContext.join('_')}_context`])].join(',');
    const reportedCoverage = finiteNumber(raw.coverage);
    const contextCoverage = (3 - missingContext.length) / 3;
    stock.coverage = Math.min(reportedCoverage ?? 1, contextCoverage);
  } else {
    stock.data_flags = typeof raw.data_flags === 'string' && raw.data_flags.trim() ? raw.data_flags : null;
  }

  return { stock: stock as unknown as Stock, incomplete };
}

function normaliseScreen(value: unknown): Screen {
  if (!value || typeof value !== 'object') {
    throw new Error('The published dataset is not a valid object.');
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.stocks)) {
    throw new Error('The published dataset does not contain a stock list.');
  }

  const issues: string[] = [];
  const stocks: Stock[] = [];
  const seen = new Set<string>();
  let rejectedRows = nonNegativeInteger(raw.decode_rejected_rows);
  let duplicateRows = 0;
  let incompleteRows = 0;
  for (const row of raw.stocks) {
    const normalised = normaliseStock(row);
    if (!normalised.stock) {
      rejectedRows += 1;
      continue;
    }
    if (seen.has(normalised.stock.symbol)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(normalised.stock.symbol);
    stocks.push(normalised.stock);
    if (normalised.incomplete) incompleteRows += 1;
  }

  const generatedAt = typeof raw.generated_at === 'string' && !Number.isNaN(Date.parse(raw.generated_at))
    ? raw.generated_at
    : '';
  const lastTradingSession =
    typeof raw.last_trading_session === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.last_trading_session)
      ? raw.last_trading_session
      : '';
  if (!generatedAt) issues.push('Build time is missing or invalid.');
  if (!lastTradingSession) issues.push('Trading session metadata is missing or invalid.');
  if (rejectedRows) issues.push(`${rejectedRows} malformed row${rejectedRows === 1 ? ' was' : 's were'} excluded.`);
  if (duplicateRows) issues.push(`${duplicateRows} duplicate ticker row${duplicateRows === 1 ? ' was' : 's were'} excluded.`);
  if (incompleteRows) {
    issues.push(
      `${incompleteRows} row${incompleteRows === 1 ? ' is' : 's are'} missing risk, liquidity, or horizon context; research scores were suppressed.`,
    );
  }

  return {
    ...raw,
    generated_at: generatedAt,
    last_trading_session: lastTradingSession,
    sessions: nonNegativeInteger(raw.sessions),
    universe_total: nonNegativeInteger(raw.universe_total),
    tradeable: nonNegativeInteger(raw.tradeable),
    scoreable: nonNegativeInteger(raw.scoreable),
    scored: nonNegativeInteger(raw.scored),
    rated_full: nonNegativeInteger(raw.rated_full),
    rated_technical: nonNegativeInteger(raw.rated_technical),
    source: typeof raw.source === 'string' && raw.source.trim() ? raw.source : 'Published static dataset',
    elapsed_s: finiteNumber(raw.elapsed_s) ?? 0,
    weights: raw.weights && typeof raw.weights === 'object' ? raw.weights : {},
    metrics: raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {},
    horizon_weights: raw.horizon_weights && typeof raw.horizon_weights === 'object' ? raw.horizon_weights : {},
    stocks,
    excluded: Array.isArray(raw.excluded) ? raw.excluded as Screen['excluded'] : [],
    investors: Array.isArray(raw.investors) ? raw.investors as Screen['investors'] : [],
    investor_holdings: Array.isArray(raw.investor_holdings) ? raw.investor_holdings as Screen['investor_holdings'] : [],
    client_quality: { issues, rejected_rows: rejectedRows, duplicate_rows: duplicateRows, incomplete_rows: incompleteRows },
  } as Screen;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function loadScreen(): Promise<Screen> {
  /**
   * Static bundle first, local backend second. There used to be a third fallback to a
   * raw screen.json at the site root, which meant shipping a 3.9MB copy of data the
   * columnar bundle already carries — for a path that can only be reached when the
   * bundle is broken, which the pre-deploy verification exists to prevent.
   */
  const attempts = [`${DATA}/screen.json`, ...(canHaveBackend() ? [`${API}/api/screen`] : [])];
  let lastError = 'no data source responded';
  for (const url of attempts) {
    try {
      const raw = await fetchJson(url);
      // Columnar bundle (static build) vs the legacy row-of-objects file.
      if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).format === 'columnar-v1') {
        const columnar = raw as { meta?: Record<string, unknown>; stocks?: Columnar; excluded?: Columnar };
        const stocks = decode<Stock>(columnar.stocks);
        const excluded = decode<Screen['excluded'][number]>(columnar.excluded);
        return normaliseScreen({
          ...columnar.meta,
          stocks: stocks.rows,
          excluded: excluded.rows,
          decode_rejected_rows: stocks.rejected,
        });
      }
      return normaliseScreen(raw);
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
  } catch (error) {
    // Static file missing (e.g. a dev machine that has not run an export yet) — fall
    // back to the local backend if one is listening.
    if (!canHaveBackend()) throw error;
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
