export interface Stock {
  ticker: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  market_cap: number | null;
  composite: number | null;
  coverage: number | null;
  band: string | null;
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

export interface Screen {
  generated_at: string;
  as_of: string;
  universe: string;
  n_scored: number;
  n_universe: number;
  weights: Record<string, number>;
  metrics: Record<string, string[]>;
  stocks: Stock[];
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
  if (score === null) return 'text-slate-500';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-teal-400';
  if (score >= 40) return 'text-amber-400';
  if (score >= 20) return 'text-orange-400';
  return 'text-rose-400';
}

export function scoreBg(score: number | null): string {
  if (score === null) return 'bg-slate-700';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-teal-500';
  if (score >= 40) return 'bg-amber-500';
  if (score >= 20) return 'bg-orange-500';
  return 'bg-rose-500';
}
