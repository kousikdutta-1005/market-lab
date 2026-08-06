export interface Stock {
  symbol: string;
  name: string | null;
  sector: string | null;
  bucket: SizeBucket | null;
  price: number | null;
  market_cap: number | null;
  composite: number | null;
  composite_raw: number | null;
  coverage: number | null;
  band: string | null;
  rating_basis: RatingBasis | null;
  pillars_used: number | null;
  turnover_median: number | null;
  trades_median: number | null;
  sessions: number | null;
  quality: number | null;
  growth: number | null;
  valuation: number | null;
  trend: number | null;
  momentum: number | null;
  ret_6m: number | null;
  ret_12m: number | null;
  ann_vol: number | null;
  years_of_data: number | null;
  roe: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  debt_to_equity: number | null;
  revenue_cagr: number | null;
  earnings_cagr: number | null;
  pe: number | null;
  pb: number | null;
  ev_ebitda: number | null;
  above_50dma: number | null;
  above_200dma: number | null;
  dist_52w_high: number | null;
  mom_6m_risk_adj: number | null;
  mom_12m_risk_adj: number | null;
  rs_vs_nifty: number | null;
  data_flags: string | null;
}

export type SizeBucket = 'large' | 'mid' | 'small' | 'micro' | 'nano';
export type RatingBasis = 'fundamental + technical' | 'technical only' | 'not rated';

export const BUCKETS: SizeBucket[] = ['large', 'mid', 'small', 'micro', 'nano'];

export const BUCKET_LABEL: Record<SizeBucket, string> = {
  large: 'Large',
  mid: 'Mid',
  small: 'Small',
  micro: 'Micro',
  nano: 'Nano',
};

export const BUCKET_HELP: Record<SizeBucket, string> = {
  large: 'Nifty 100 — the 100 biggest listed companies.',
  mid: 'Nifty Midcap 150 — ranks 101 to 250 by market cap.',
  small: 'Nifty Smallcap 250 — ranks 251 to 500.',
  micro: 'Nifty Microcap 250 — ranks 501 to 750.',
  nano: 'Listed but in no index — below roughly rank 750. Thinly covered and thinly traded.',
};

export interface ExcludedStock {
  symbol: string;
  bucket: SizeBucket | null;
  tradeable: boolean;
  reasons: string[];
  turnover_median: number | null;
  sessions: number | null;
}

export interface Screen {
  generated_at: string;
  last_trading_session: string;
  sessions: number;
  universe_total: number;
  tradeable: number;
  scoreable: number;
  scored: number;
  rated_full: number;
  rated_technical: number;
  source: string;
  elapsed_s: number;
  weights: Record<string, number>;
  metrics: Record<string, string[]>;
  stocks: Stock[];
  excluded: ExcludedStock[];
}

export interface MarketPhase {
  phase: string;
  is_open: boolean;
  now_ist: string;
  new_data_expected: string | null;
}

export interface JobState {
  running: boolean;
  stage: string;
  log: string[];
  error: string | null;
  elapsed_s: number | null;
  result: Record<string, unknown> | null;
}

export interface Status {
  market: MarketPhase;
  data: Partial<Screen> & { exists: boolean; age_s?: number };
  job: JobState;
  server_time: string;
}

export interface SourceProbe {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
  note: string;
}

export const PILLARS = ['quality', 'growth', 'valuation', 'trend', 'momentum'] as const;
export type Pillar = (typeof PILLARS)[number];

export const PILLAR_HELP: Record<Pillar, string> = {
  quality: 'Return on equity, operating and net margin, and debt load. Measures how profitable and financially sound the business currently is.',
  growth: 'Revenue and earnings growth annualised across available statement years. Backward-looking — it is what already happened, not a projection.',
  valuation: 'P/E, P/B and EV/EBITDA. Higher percentile means cheaper relative to peers. Cheap can mean mispriced, or it can mean the market knows something.',
  trend: 'Price versus its 50 and 200-day averages, and distance from the 52-week high. Describes where the price sits, nothing more.',
  momentum: '6 and 12-month returns divided by annualised volatility, plus relative strength versus the Nifty. This is NSE Nifty200 Momentum 30 style scoring.',
};

export const METRIC_LABELS: Record<string, string> = {
  roe: 'Return on equity',
  operating_margin: 'Operating margin',
  net_margin: 'Net margin',
  debt_to_equity: 'Debt / equity',
  revenue_cagr: 'Revenue CAGR',
  earnings_cagr: 'Earnings CAGR',
  pe: 'P / E',
  pb: 'P / B',
  ev_ebitda: 'EV / EBITDA',
  above_50dma: 'vs 50-day avg',
  above_200dma: 'vs 200-day avg',
  dist_52w_high: 'From 52w high',
  mom_6m_risk_adj: '6m risk-adj momentum',
  mom_12m_risk_adj: '12m risk-adj momentum',
  rs_vs_nifty: 'Relative strength vs Nifty',
};

const PERCENT_METRICS = new Set([
  'roe', 'operating_margin', 'net_margin', 'revenue_cagr', 'earnings_cagr',
  'above_50dma', 'above_200dma', 'dist_52w_high', 'rs_vs_nifty',
]);

export function formatMetric(key: string, value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (PERCENT_METRICS.has(key)) {
    const pct = ['above_50dma', 'above_200dma', 'dist_52w_high'].includes(key) ? value : value * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }
  return value.toFixed(2);
}

export function formatCrore(marketCap: number | null): string {
  if (!marketCap) return '—';
  const cr = marketCap / 1e7;
  if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(2)}L cr`;
  return `₹${cr.toLocaleString('en-IN', { maximumFractionDigits: 0 })} cr`;
}

export function scoreColor(score: number | null): string {
  if (score == null) return 'text-slate-500';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-teal-400';
  if (score >= 40) return 'text-amber-400';
  if (score >= 20) return 'text-orange-400';
  return 'text-rose-400';
}

export function scoreBg(score: number | null): string {
  if (score == null) return 'bg-slate-700';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-teal-500';
  if (score >= 40) return 'bg-amber-500';
  if (score >= 20) return 'bg-orange-500';
  return 'bg-rose-500';
}

export function formatTurnover(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const cr = v / 1e7;
  if (cr >= 1000) return `₹${(cr / 1000).toFixed(1)}k cr`;
  if (cr >= 1) return `₹${cr.toFixed(1)} cr`;
  return `₹${(v / 1e5).toFixed(1)} L`;
}

export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export const BASIS_HELP: Record<RatingBasis, string> = {
  'fundamental + technical':
    'Scored on all five pillars: the accounts were available as well as the price history.',
  'technical only':
    'Scored on price behaviour alone — trend and momentum. No financial statements were available for this company, so nothing here reflects profitability, debt or valuation. Not comparable with a fundamental + technical score.',
  'not rated':
    'Too little data to score on more than one pillar. Shown so the gap is visible rather than silently dropped.',
};
