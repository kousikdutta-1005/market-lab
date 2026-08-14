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
  investable_score: number | null;
  best_horizon: HorizonKey | null;
  short_fit: number | null;
  medium_fit: number | null;
  long_fit: number | null;
  liquidity_score: number | null;
  news_event_score: number | null;
  news_count_14d: number | null;
  news_positive_14d: number | null;
  news_negative_14d: number | null;
  news_neutral_14d: number | null;
  news_last_date: string | null;
  news_last_title: string | null;
  news_last_url: string | null;
  deal_activity_score: number | null;
  deal_count: number | null;
  bulk_deal_count: number | null;
  block_deal_count: number | null;
  short_deal_count: number | null;
  deal_value: number | null;
  bulk_deal_value: number | null;
  block_deal_value: number | null;
  deal_net_qty: number | null;
  deal_latest_client: string | null;
  deal_latest_type: string | null;
  deal_latest_side: string | null;
  deal_latest_date: string | null;
  delivery_accumulation_score: number | null;
  delivery_pct_latest: number | null;
  delivery_pct_median_20d: number | null;
  delivery_value_median_20d: number | null;
  delivery_spike: number | null;
  high_delivery_days_20d: number | null;
  delivery_source_date: string | null;
  risk_score: number | null;
  risk_level: 'Low' | 'Watch' | 'High' | null;
  risk_flags: string | null;
  fno_ban: boolean | null;
  /**
   * Surfaced as "research score". The field keeps its original name because it is written
   * by the pipeline, exported in the payload and referenced by the AI query schema, and
   * renaming it across all three buys nothing. The label matters because it is what a
   * reader sees: "opportunity" implies something to act on, which this is not — it is a
   * percentile rank against comparable peers.
   */
  opportunity_score: number | null;
  sast_events_180d: number | null;
  sast_acquisitions: number | null;
  sast_disposals: number | null;
  sast_net_shares: number | null;
  sast_promoter_buying: boolean | null;
  sast_promoter_selling: boolean | null;
  sast_latest_holder: string | null;
  sast_latest_action: string | null;
  sast_latest_stake: number | null;
  sast_latest_date: string | null;
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
  roa: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  debt_to_equity: number | null;
  revenue_cagr: number | null;
  earnings_cagr: number | null;
  pe: number | null;
  pb: number | null;
  ev_ebitda: number | null;
  dividend_yield: number | null;
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
export type HorizonKey = 'short' | 'medium' | 'long';
export type HorizonScoreKey = 'short_fit' | 'medium_fit' | 'long_fit';

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

export const HORIZONS: Array<{ key: HorizonKey; scoreKey: HorizonScoreKey; label: string; detail: string }> = [
  { key: 'short', scoreKey: 'short_fit', label: '1-3m', detail: 'Momentum, trend, liquidity and official events' },
  { key: 'medium', scoreKey: 'medium_fit', label: '6-12m', detail: 'Balanced fundamentals, technicals and events' },
  { key: 'long', scoreKey: 'long_fit', label: '3-5y', detail: 'Quality, growth, valuation and liquidity' },
];

export const HORIZON_LABEL: Record<HorizonKey, string> = {
  short: '1-3m',
  medium: '6-12m',
  long: '3-5y',
};

export interface ExcludedStock {
  symbol: string;
  bucket: SizeBucket | null;
  tradeable: boolean;
  reasons: string[];
  turnover_median: number | null;
  sessions: number | null;
}

export interface InvestorPosition {
  symbol: string;
  action: string;
  events: number;
  stake: number | null;
  when: string | null;
  source: string;
}

export interface Investor {
  name: string;
  /** promoter | institution | intermediary | investor */
  kind: string;
  stocks: number;
  events: number;
  buys: number;
  sells: number;
  latest_symbol: string;
  latest_action: string;
  latest_date: string | null;
  sources: string[];
  positions: InvestorPosition[];
}

export interface InvestorHolding {
  symbol: string;
  pct: number | null;
  shares: number | null;
}

export interface InvestorPortfolio {
  name: string;
  kind: string;
  stocks: number;
  as_of: string | null;
  largest_stake: number;
  holdings: InvestorHolding[];
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
  horizon_weights: Record<string, { label: string; weights: Record<string, number> }>;
  live_quote_status: string;
  live_quote_source: string | null;
  live_quote_detail: string;
  news_source: string;
  news_window_days: number;
  news_rows: number | null;
  news_nse_rows?: number | null;
  news_bse_rows?: number | null;
  news_symbols: number;
  news_status: string;
  news_error?: string;
  deal_source?: string;
  deal_status?: string;
  deal_rows?: number | null;
  deal_symbols?: number;
  deal_as_on?: string | null;
  delivery_source?: string;
  delivery_status?: string;
  delivery_rows?: number | null;
  delivery_symbols?: number;
  delivery_window_sessions?: number;
  risk_source?: string;
  risk_status?: string;
  risk_error?: string;
  fo_ban_count?: number;
  high_risk_symbols?: number;
  ca_status?: string;
  ca_symbols?: number;
  ca_events?: number;
  ca_examples?: string[];
  ownership_status?: string;
  ownership_symbols?: number;
  ownership_rows?: number;
  fii_net_cr?: number;
  dii_net_cr?: number;
  fii_dii_status?: string;
  macro_status?: string;
  market_regime?: string;
  market_regime_summary?: string;
  breadth_advancers?: number;
  breadth_decliners?: number;
  breadth_traded?: number;
  breadth_advance_pct?: number;
  above_50dma_pct?: number;
  above_200dma_pct?: number;
  median_1m_return_pct?: number | null;
  investors?: Investor[];
  investor_holdings?: InvestorPortfolio[];
  shp_symbols?: number;
  disclosures_updated_at?: string;
  client_quality?: {
    issues: string[];
    rejected_rows: number;
    duplicate_rows: number;
    incomplete_rows: number;
  };
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

export interface ChartPoint {
  date: string;
  close: number;
  return_pct: number | null;
  market_return_pct: number | null;
  ma50: number | null;
  ma200: number | null;
  volume: number | null;
  turnover: number | null;
}

export interface StockChartResponse {
  symbol: string;
  range: string;
  source: string;
  last_date: string | null;
  points: ChartPoint[];
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
  roa: 'Return on assets',
  operating_margin: 'Operating margin',
  net_margin: 'Net margin',
  debt_to_equity: 'Debt / equity',
  revenue_cagr: 'Revenue CAGR',
  earnings_cagr: 'Earnings CAGR',
  pe: 'P / E',
  pb: 'P / B',
  ev_ebitda: 'EV / EBITDA',
  dividend_yield: 'Dividend yield',
  above_50dma: 'vs 50-day avg',
  above_200dma: 'vs 200-day avg',
  dist_52w_high: 'From 52w high',
  mom_6m_risk_adj: '6m risk-adj momentum',
  mom_12m_risk_adj: '12m risk-adj momentum',
  rs_vs_nifty: 'Relative strength vs Nifty',
};

const PERCENT_METRICS = new Set([
  'roe', 'roa', 'operating_margin', 'net_margin', 'revenue_cagr', 'earnings_cagr', 'dividend_yield',
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

/**
 * Score colours.
 *
 * These were 400-weight, chosen when the app was dark. On the current light surface
 * text-success sits around 2:1 against white, well under the 4.5:1 WCAG AA minimum,
 * so the most important numbers on the board were the hardest to read. Semantic tokens
 * fix the contrast and follow the theme into dark mode.
 */
export function scoreColor(score: number | null): string {
  if (score == null) return 'text-muted-foreground';
  if (score >= 80) return 'text-success';
  if (score >= 60) return 'text-foreground';
  if (score >= 40) return 'text-warning';
  return 'text-danger';
}

export function scoreBg(score: number | null): string {
  if (score == null) return 'bg-muted';
  if (score >= 80) return 'bg-success';
  if (score >= 60) return 'bg-primary';
  if (score >= 40) return 'bg-warning';
  return 'bg-danger';
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
