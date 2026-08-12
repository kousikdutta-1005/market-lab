import type { ReactNode } from 'react';
import { LineChart, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { OwnershipBadge } from '../OwnershipBadge';
import {
  BUCKET_LABEL, HORIZON_LABEL, formatCrore, formatTurnover, scoreBg, scoreColor,
  type HorizonScoreKey, type Stock,
} from '../types';

/**
 * One definition per column, used by the table, the column picker and the CSV export.
 *
 * The table previously hard-coded fifteen columns behind `{dense && …}` guards, which
 * meant the only choice on offer was "six columns or fifteen" and adding a metric meant
 * editing three places. A screener's job is to let someone build the view they need, so
 * columns are data now: every field the pipeline exports can be shown, sorted and
 * exported without touching the table.
 */
export type ColumnGroup =
  | 'Ranking'
  | 'Company'
  | 'Score pillars'
  | 'Flow and ownership'
  | 'Fundamentals'
  | 'Technicals'
  | 'Liquidity';

export const COLUMN_GROUPS: ColumnGroup[] = [
  'Ranking',
  'Company',
  'Score pillars',
  'Flow and ownership',
  'Fundamentals',
  'Technicals',
  'Liquidity',
];

export interface ColumnContext {
  rankingKey: HorizonScoreKey;
  horizonLabel: string;
}

export interface Column {
  id: string;
  label: (ctx: ColumnContext) => string;
  group: ColumnGroup;
  /** Numeric columns are right-aligned; text columns are not. */
  numeric?: boolean;
  /** Field to sort by. Columns without one are not sortable. */
  sortKey?: (ctx: ColumnContext) => keyof Stock;
  help?: string;
  /** Pinned columns cannot be hidden and stay at the left edge. */
  pinned?: boolean;
  cell: (s: Stock, ctx: ColumnContext) => ReactNode;
  /** Plain value for CSV. Keep it raw — a spreadsheet should get numbers, not "₹1.2 cr". */
  csv: (s: Stock, ctx: ColumnContext) => string | number | null;
  /** Estimated width in px, used to size the horizontal scroll container. */
  width: number;
}

const DASH = <span className="text-muted-foreground">—</span>;

function num(v: number | null | undefined, digits = 0): ReactNode {
  if (v == null || Number.isNaN(v)) return DASH;
  return <span className="tabular-nums">{v.toFixed(digits)}</span>;
}

function pct(v: number | null | undefined, scale = 100): ReactNode {
  if (v == null || Number.isNaN(v)) return DASH;
  const p = v * scale;
  return (
    <span className={`tabular-nums ${p >= 0 ? 'text-foreground' : 'text-danger'}`}>
      {p >= 0 ? '+' : ''}{p.toFixed(1)}%
    </span>
  );
}

function score(v: number | null | undefined): ReactNode {
  if (v == null || Number.isNaN(v)) return DASH;
  return <span className={`font-semibold tabular-nums ${scoreColor(v)}`}>{v.toFixed(0)}</span>;
}

function Bar({ value }: { value: number | null }) {
  if (value == null) return DASH;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${scoreBg(value)}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{value.toFixed(0)}</span>
    </div>
  );
}

function RiskBadge({ stock }: { stock: Stock }) {
  const risk = stock.risk_level ?? '—';
  const cls = risk === 'High'
    ? 'border-danger/30 bg-danger-subtle text-danger hover:bg-danger-subtle'
    : risk === 'Watch'
      ? 'border-warning/30 bg-warning-subtle text-warning hover:bg-warning-subtle'
      : 'border-success/30 bg-success-subtle text-success hover:bg-success-subtle';
  return (
    <Badge variant="outline" className={cls} title={stock.risk_flags ?? undefined}>
      {risk}
    </Badge>
  );
}

/** A metric column: score-coloured number, right-aligned, sortable. Most columns are this. */
function scoreCol(
  id: string,
  label: string,
  key: keyof Stock,
  group: ColumnGroup,
  help: string,
  width = 96,
): Column {
  return {
    id,
    label: () => label,
    group,
    numeric: true,
    sortKey: () => key,
    help,
    width,
    cell: (s) => score(s[key] as number | null),
    csv: (s) => s[key] as number | null,
  };
}

/** A percentage column. `scale` is 100 when the source stores a fraction, 1 when a percent. */
function pctCol(
  id: string,
  label: string,
  key: keyof Stock,
  group: ColumnGroup,
  help: string,
  scale = 100,
  width = 100,
): Column {
  return {
    id,
    label: () => label,
    group,
    numeric: true,
    sortKey: () => key,
    help,
    width,
    cell: (s) => pct(s[key] as number | null, scale),
    csv: (s) => {
      const v = s[key] as number | null;
      return v == null ? null : Number((v * scale).toFixed(2));
    },
  };
}

/** A plain ratio column — P/E, debt/equity and similar. */
function ratioCol(
  id: string,
  label: string,
  key: keyof Stock,
  group: ColumnGroup,
  help: string,
  width = 88,
): Column {
  return {
    id,
    label: () => label,
    group,
    numeric: true,
    sortKey: () => key,
    help,
    width,
    cell: (s) => num(s[key] as number | null, 1),
    csv: (s) => s[key] as number | null,
  };
}

export const COLUMNS: Column[] = [
  {
    id: 'stock',
    label: () => 'Stock',
    group: 'Company',
    pinned: true,
    sortKey: () => 'symbol',
    width: 230,
    cell: (s) => (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-foreground">{s.symbol}</span>
            {s.bucket && <Badge variant="secondary">{BUCKET_LABEL[s.bucket]}</Badge>}
            {s.rating_basis === 'technical only' && (
              <Badge
                variant="outline"
                title="Scored on price behaviour only — no financial statements were available for this company."
                className="border-warning/30 bg-warning-subtle text-warning hover:bg-warning-subtle"
              >
                <LineChart className="size-2.5" />
                tech
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{s.name}</div>
          <OwnershipBadge stock={s} compact />
        </div>
        {s.data_flags ? (
          <span title={s.data_flags} className="shrink-0">
            <TriangleAlert className="size-3.5 text-warning" />
          </span>
        ) : null}
      </div>
    ),
    csv: (s) => s.symbol,
  },

  // Ranking
  scoreCol('opportunity', 'Research score', 'opportunity_score', 'Ranking',
    'How well this company scores across every pillar, flow and risk signal, ranked against '
    + 'comparable peers. A measurement of research interest, not a prediction or a recommendation.', 124),
  {
    id: 'fit',
    label: (ctx) => `Fit ${ctx.horizonLabel}`,
    group: 'Ranking',
    numeric: true,
    sortKey: (ctx) => ctx.rankingKey,
    help: 'How well the stock fits the holding period selected above.',
    width: 100,
    cell: (s, ctx) => score(s[ctx.rankingKey]),
    csv: (s, ctx) => s[ctx.rankingKey],
  },
  {
    id: 'best_horizon',
    label: () => 'Scores highest for',
    group: 'Ranking',
    width: 110,
    cell: (s) => (
      <span className="text-xs text-muted-foreground">
        {s.best_horizon ? HORIZON_LABEL[s.best_horizon] : '—'}
      </span>
    ),
    csv: (s) => (s.best_horizon ? HORIZON_LABEL[s.best_horizon] : null),
  },
  {
    id: 'risk',
    label: () => 'Risk',
    group: 'Ranking',
    sortKey: () => 'risk_score',
    help: 'Volatility, drawdown, liquidity and data-quality diagnostics rolled into one level.',
    width: 92,
    cell: (s) => <RiskBadge stock={s} />,
    csv: (s) => s.risk_level,
  },
  scoreCol('composite', 'Composite', 'composite', 'Ranking',
    'Average of the five pillar ranks, re-ranked within the size bucket.', 100),
  scoreCol('investable', 'Investability', 'investable_score', 'Ranking',
    'Composite adjusted for liquidity and data coverage.', 106),

  // Company
  {
    id: 'sector',
    label: () => 'Sector',
    group: 'Company',
    width: 150,
    cell: (s) => <span className="block max-w-36 truncate text-xs text-muted-foreground">{s.sector ?? '—'}</span>,
    csv: (s) => s.sector,
  },
  {
    id: 'bucket',
    label: () => 'Size',
    group: 'Company',
    width: 84,
    cell: (s) => <span className="text-xs text-muted-foreground">{s.bucket ? BUCKET_LABEL[s.bucket] : '—'}</span>,
    csv: (s) => s.bucket,
  },
  {
    id: 'price',
    label: () => 'Price',
    group: 'Company',
    numeric: true,
    sortKey: () => 'price',
    width: 92,
    cell: (s) => (s.price == null ? DASH : <span className="tabular-nums">₹{s.price.toFixed(2)}</span>),
    csv: (s) => s.price,
  },
  {
    id: 'mcap',
    label: () => 'Market cap',
    group: 'Company',
    numeric: true,
    sortKey: () => 'market_cap',
    width: 116,
    cell: (s) => <span className="tabular-nums text-muted-foreground">{formatCrore(s.market_cap)}</span>,
    csv: (s) => (s.market_cap == null ? null : Math.round(s.market_cap / 1e7)),
  },
  {
    id: 'basis',
    label: () => 'Rated on',
    group: 'Company',
    width: 150,
    help: 'Whether the score used financial statements as well as price history.',
    cell: (s) => <span className="text-xs text-muted-foreground">{s.rating_basis ?? '—'}</span>,
    csv: (s) => s.rating_basis,
  },

  // Score pillars
  ...(['quality', 'growth', 'valuation', 'trend', 'momentum'] as const).map<Column>((p) => ({
    id: p,
    label: () => p.charAt(0).toUpperCase() + p.slice(1),
    group: 'Score pillars',
    numeric: true,
    sortKey: () => p,
    width: 104,
    cell: (s) => <Bar value={s[p]} />,
    csv: (s) => s[p],
  })),

  // Flow and ownership
  scoreCol('delivery', 'Delivery', 'delivery_accumulation_score', 'Flow and ownership',
    'How much of recent volume was taken as delivery rather than traded intraday.', 96),
  pctCol('delivery_pct', 'Delivery %', 'delivery_pct_latest', 'Flow and ownership',
    'Share of the latest session\'s volume settled as delivery.', 1, 100),
  {
    id: 'deals',
    label: () => 'Deals',
    group: 'Flow and ownership',
    numeric: true,
    sortKey: () => 'deal_count',
    help: 'Bulk, block and short deals disclosed by NSE.',
    width: 84,
    cell: (s) => (
      <span className="tabular-nums" title={s.deal_latest_client ?? undefined}>
        {s.deal_count?.toFixed(0) ?? '0'}
      </span>
    ),
    csv: (s) => s.deal_count ?? 0,
  },
  {
    id: 'deal_value',
    label: () => 'Deal value',
    group: 'Flow and ownership',
    numeric: true,
    sortKey: () => 'deal_value',
    width: 108,
    cell: (s) => <span className="tabular-nums text-muted-foreground">{formatTurnover(s.deal_value)}</span>,
    csv: (s) => s.deal_value,
  },
  scoreCol('events', 'Events', 'news_event_score', 'Flow and ownership',
    'Official NSE and BSE corporate announcements in the last 14 days.', 92),
  {
    id: 'event_count',
    label: () => 'Filings 14d',
    group: 'Flow and ownership',
    numeric: true,
    sortKey: () => 'news_count_14d',
    width: 100,
    cell: (s) => (
      <span className="tabular-nums" title={s.news_last_title ?? undefined}>
        {s.news_count_14d ?? 0}
      </span>
    ),
    csv: (s) => s.news_count_14d ?? 0,
  },
  {
    id: 'holder',
    label: () => 'Latest large holder',
    group: 'Flow and ownership',
    width: 200,
    help: 'Most recent SEBI SAST disclosure — someone crossing a reportable stake.',
    cell: (s) =>
      s.sast_latest_holder ? (
        <div className="min-w-0">
          <div className="max-w-44 truncate text-xs text-foreground">{s.sast_latest_holder}</div>
          <div className="text-[10px] text-muted-foreground">
            {s.sast_latest_action ?? ''}
            {s.sast_latest_stake != null ? ` · ${s.sast_latest_stake.toFixed(2)}%` : ''}
          </div>
        </div>
      ) : (
        DASH
      ),
    csv: (s) => s.sast_latest_holder,
  },
  {
    id: 'sast_filings',
    label: () => 'SAST 180d',
    group: 'Flow and ownership',
    numeric: true,
    sortKey: () => 'sast_events_180d',
    help: 'Large-shareholder disclosures filed in the last 180 days.',
    width: 100,
    cell: (s) => <span className="tabular-nums">{s.sast_events_180d ?? 0}</span>,
    csv: (s) => s.sast_events_180d ?? 0,
  },

  // Fundamentals
  ratioCol('pe', 'P/E', 'pe', 'Fundamentals', 'Price to trailing earnings.'),
  ratioCol('pb', 'P/B', 'pb', 'Fundamentals', 'Price to book value.'),
  ratioCol('ev_ebitda', 'EV/EBITDA', 'ev_ebitda', 'Fundamentals',
    'Enterprise value to operating earnings — comparable across capital structures.', 108),
  pctCol('roe', 'ROE', 'roe', 'Fundamentals', 'Return on equity.'),
  pctCol('roa', 'ROA', 'roa', 'Fundamentals', 'Return on assets.'),
  pctCol('opm', 'Op margin', 'operating_margin', 'Fundamentals', 'Operating margin.'),
  pctCol('npm', 'Net margin', 'net_margin', 'Fundamentals', 'Net profit margin.'),
  ratioCol('de', 'Debt/Eq', 'debt_to_equity', 'Fundamentals', 'Debt to equity.', 96),
  pctCol('rev_cagr', 'Rev CAGR', 'revenue_cagr', 'Fundamentals', 'Compound revenue growth.'),
  pctCol('eps_cagr', 'Profit CAGR', 'earnings_cagr', 'Fundamentals', 'Compound earnings growth.', 100, 108),
  pctCol('div_yield', 'Div yield', 'dividend_yield', 'Fundamentals', 'Dividend yield.', 100),

  // Technicals
  pctCol('ret_6m', '6m return', 'ret_6m', 'Technicals', 'Price change over six months, adjusted for splits and bonuses.'),
  pctCol('ret_12m', '12m return', 'ret_12m', 'Technicals', 'Price change over one year, adjusted for splits and bonuses.'),
  pctCol('ann_vol', 'Volatility', 'ann_vol', 'Technicals', 'Annualised standard deviation of daily returns.'),
  pctCol('rs', 'RS vs Nifty', 'rs_vs_nifty', 'Technicals', 'Relative strength against the index.', 100, 108),
  pctCol('dma50', 'vs 50 DMA', 'above_50dma', 'Technicals', 'Distance from the 50-day moving average.', 1),
  pctCol('dma200', 'vs 200 DMA', 'above_200dma', 'Technicals', 'Distance from the 200-day moving average.', 1),
  pctCol('from_high', 'From 52w high', 'dist_52w_high', 'Technicals', 'Drawdown from the 52-week high.', 1, 118),

  // Liquidity
  {
    id: 'turnover',
    label: () => 'Avg daily turnover',
    group: 'Liquidity',
    numeric: true,
    sortKey: () => 'turnover_median',
    help: 'Median daily traded value over the last year, as reported by NSE.',
    width: 140,
    cell: (s) => <span className="tabular-nums text-muted-foreground">{formatTurnover(s.turnover_median)}</span>,
    csv: (s) => s.turnover_median,
  },
  {
    id: 'trades',
    label: () => 'Trades/day',
    group: 'Liquidity',
    numeric: true,
    sortKey: () => 'trades_median',
    width: 104,
    cell: (s) => (s.trades_median == null ? DASH : <span className="tabular-nums text-muted-foreground">{Math.round(s.trades_median).toLocaleString('en-IN')}</span>),
    csv: (s) => s.trades_median,
  },
  scoreCol('liquidity_score', 'Liquidity score', 'liquidity_score', 'Liquidity',
    'Tradeability rank within the whole universe.', 120),
  {
    id: 'sessions',
    label: () => 'Sessions',
    group: 'Liquidity',
    numeric: true,
    sortKey: () => 'sessions',
    help: 'Trading sessions of price history available.',
    width: 96,
    cell: (s) => num(s.sessions, 0),
    csv: (s) => s.sessions,
  },
];

export const COLUMN_BY_ID = new Map(COLUMNS.map((c) => [c.id, c]));

/**
 * Named starting points.
 *
 * Nobody builds a fourteen-column view from scratch, and a picker with forty checkboxes
 * and no defaults is its own kind of hostile. Presets answer the common questions in one
 * click and stay editable afterwards.
 */
export const PRESETS: Array<{ id: string; label: string; hint: string; columns: string[] }> = [
  {
    id: 'essentials',
    label: 'Essentials',
    hint: 'The ranking and how tradeable it is',
    columns: ['stock', 'opportunity', 'fit', 'risk', 'turnover'],
  },
  {
    id: 'screener',
    label: 'Full screener',
    hint: 'Scores, pillars and flow together',
    columns: [
      'stock', 'opportunity', 'fit', 'risk', 'delivery', 'deals', 'composite', 'turnover',
      'events', 'quality', 'growth', 'valuation', 'trend', 'momentum',
    ],
  },
  {
    id: 'fundamentals',
    label: 'Fundamentals',
    hint: 'Valuation, profitability and growth',
    columns: ['stock', 'mcap', 'pe', 'pb', 'ev_ebitda', 'roe', 'de', 'rev_cagr', 'eps_cagr', 'div_yield'],
  },
  {
    id: 'technicals',
    label: 'Technicals',
    hint: 'Returns, trend and volatility',
    columns: ['stock', 'price', 'ret_6m', 'ret_12m', 'ann_vol', 'rs', 'dma50', 'dma200', 'from_high'],
  },
  {
    id: 'ownership',
    label: 'Ownership and flow',
    hint: 'Who is buying and how it settles',
    columns: ['stock', 'holder', 'sast_filings', 'delivery', 'delivery_pct', 'deals', 'deal_value', 'events'],
  },
];

export function presetColumns(id: string): string[] {
  return PRESETS.find((p) => p.id === id)?.columns ?? PRESETS[1].columns;
}

/** Keep columns in registry order regardless of the order they were toggled on. */
export function orderColumns(ids: string[]): Column[] {
  const wanted = new Set(ids);
  return COLUMNS.filter((c) => c.pinned || wanted.has(c.id));
}

function csvCell(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export every filtered row — a screener result is the thing worth keeping, not one page. */
export function toCsv(rows: Stock[], columns: Column[], ctx: ColumnContext): string {
  const head = columns.map((c) => csvCell(c.label(ctx))).join(',');
  const body = rows.map((s) => columns.map((c) => csvCell(c.csv(s, ctx))).join(','));
  return [head, ...body].join('\n');
}

export function downloadCsv(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
