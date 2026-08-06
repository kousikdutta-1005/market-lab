/**
 * Portfolio analysis computed entirely from the same data the board is built on.
 *
 * Design rule, and the reason this is worth trusting: **nothing here is estimated.**
 * Every figure is either arithmetic over holdings the user entered, or a value that came
 * out of an official NSE file. Where an input is missing, the metric is reported as
 * unavailable rather than filled with a plausible number — a portfolio tool that quietly
 * imputes a missing price is worse than one that admits the gap, because the user cannot
 * tell which figures were real.
 *
 * It runs in the browser against local data, so holdings never leave the device and there
 * is no account, no server and no cost.
 */
import type { Screen, Stock } from '../types';
import { loadChart } from './dataSource';

export type Holding = {
  symbol: string;
  qty: number;
  /** Average buy price. Optional: without it, P&L is unavailable but exposure is not. */
  avgPrice?: number | null;
};

export type HoldingAnalysis = {
  holding: Holding;
  stock: Stock | null;
  /** Reason this holding could not be fully analysed, if any. */
  issue: string | null;
  price: number | null;
  value: number | null;
  weight: number;
  invested: number | null;
  pnl: number | null;
  pnlPct: number | null;
  /** Sessions to exit at 10% of median daily traded value — the constraint retail ignores. */
  daysToExit: number | null;
};

export type Concentration = {
  /** Herfindahl-Hirschman Index over weights: 1 = everything in one stock. */
  hhi: number;
  /** Number of equally-weighted positions that would carry the same concentration. */
  effectiveHoldings: number;
  topWeight: number;
  top3Weight: number;
};

export type PortfolioAnalysis = {
  holdings: HoldingAnalysis[];
  unmatched: string[];
  totalValue: number;
  totalInvested: number | null;
  totalPnl: number | null;
  totalPnlPct: number | null;
  concentration: Concentration;
  bySector: { key: string; value: number; weight: number }[];
  byBucket: { key: string; value: number; weight: number }[];
  factors: { pillar: string; score: number | null }[];
  risk: {
    weightedRiskScore: number | null;
    highRiskWeight: number;
    fnoBanWeight: number;
    unratedWeight: number;
    technicalOnlyWeight: number;
  };
  liquidity: {
    illiquidWeight: number;
    worstDaysToExit: number | null;
    medianDaysToExit: number | null;
  };
  /** Share of portfolio value that could be analysed at all. */
  coverage: number;
};

const EXIT_PARTICIPATION = 0.1;

function weightedAverage(pairs: [number | null | undefined, number][]): number | null {
  let num = 0;
  let den = 0;
  for (const [v, w] of pairs) {
    if (v == null || Number.isNaN(v)) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function groupWeights(items: HoldingAnalysis[], key: (h: HoldingAnalysis) => string | null, total: number) {
  const map = new Map<string, number>();
  for (const h of items) {
    if (h.value == null) continue;
    const k = key(h) ?? 'Unknown';
    map.set(k, (map.get(k) ?? 0) + h.value);
  }
  return [...map.entries()]
    .map(([k, v]) => ({ key: k, value: v, weight: total > 0 ? v / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

export function analysePortfolio(holdings: Holding[], screen: Screen): PortfolioAnalysis {
  const index = new Map(screen.stocks.map((s) => [s.symbol.toUpperCase(), s]));
  const unmatched: string[] = [];

  const rows: HoldingAnalysis[] = holdings.map((h) => {
    const sym = h.symbol.toUpperCase().trim();
    const stock = index.get(sym) ?? null;
    let issue: string | null = null;
    if (!stock) {
      issue = 'Not in the scored NSE universe (may be delisted, illiquid, or an excluded stock).';
      unmatched.push(sym);
    } else if (stock.price == null) {
      issue = 'No official closing price in the latest bhavcopy.';
    }

    const price = stock?.price ?? null;
    const value = price != null ? price * h.qty : null;
    const invested = h.avgPrice != null && h.avgPrice > 0 ? h.avgPrice * h.qty : null;
    const pnl = value != null && invested != null ? value - invested : null;
    const pnlPct = pnl != null && invested ? pnl / invested : null;

    // How many sessions to unwind without being more than EXIT_PARTICIPATION of volume.
    const adv = stock?.turnover_median ?? null;
    const daysToExit = value != null && adv && adv > 0 ? value / (adv * EXIT_PARTICIPATION) : null;

    return { holding: { ...h, symbol: sym }, stock, issue, price, value, weight: 0, invested, pnl, pnlPct, daysToExit };
  });

  const totalValue = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  for (const r of rows) r.weight = totalValue > 0 && r.value != null ? r.value / totalValue : 0;

  const investedRows = rows.filter((r) => r.invested != null);
  const totalInvested = investedRows.length ? investedRows.reduce((a, r) => a + (r.invested ?? 0), 0) : null;
  // Only compare like with like: a holding with no cost basis must not deflate returns.
  const valueWithBasis = investedRows.reduce((a, r) => a + (r.value ?? 0), 0);
  const totalPnl = totalInvested != null ? valueWithBasis - totalInvested : null;
  const totalPnlPct = totalPnl != null && totalInvested ? totalPnl / totalInvested : null;

  const weights = rows.map((r) => r.weight).filter((w) => w > 0);
  const hhi = weights.reduce((a, w) => a + w * w, 0);
  const sorted = [...weights].sort((a, b) => b - a);
  const concentration: Concentration = {
    hhi,
    effectiveHoldings: hhi > 0 ? 1 / hhi : 0,
    topWeight: sorted[0] ?? 0,
    top3Weight: sorted.slice(0, 3).reduce((a, w) => a + w, 0),
  };

  const analysable = rows.filter((r) => r.stock && r.value != null);
  const wp = (get: (s: Stock) => number | null | undefined) =>
    weightedAverage(analysable.map((r) => [get(r.stock as Stock), r.weight] as [number | null | undefined, number]));

  const weightOf = (pred: (r: HoldingAnalysis) => boolean) =>
    analysable.filter(pred).reduce((a, r) => a + r.weight, 0);

  const exits = analysable.map((r) => r.daysToExit).filter((d): d is number => d != null).sort((a, b) => a - b);

  return {
    holdings: rows,
    unmatched,
    totalValue,
    totalInvested,
    totalPnl,
    totalPnlPct,
    concentration,
    bySector: groupWeights(rows, (h) => h.stock?.sector ?? null, totalValue),
    byBucket: groupWeights(rows, (h) => h.stock?.bucket ?? null, totalValue),
    factors: (['quality', 'growth', 'valuation', 'trend', 'momentum'] as const).map((p) => ({
      pillar: p,
      score: wp((s) => s[p]),
    })),
    risk: {
      weightedRiskScore: wp((s) => s.risk_score),
      highRiskWeight: weightOf((r) => r.stock?.risk_level === 'High'),
      fnoBanWeight: weightOf((r) => !!r.stock?.fno_ban),
      unratedWeight: weightOf((r) => r.stock?.composite == null),
      technicalOnlyWeight: weightOf((r) => r.stock?.rating_basis === 'technical only'),
    },
    liquidity: {
      illiquidWeight: weightOf((r) => (r.daysToExit ?? 0) > 5),
      worstDaysToExit: exits.length ? exits[exits.length - 1] : null,
      medianDaysToExit: exits.length ? exits[Math.floor(exits.length / 2)] : null,
    },
    coverage: totalValue > 0 ? analysable.reduce((a, r) => a + (r.value ?? 0), 0) / totalValue : 0,
  };
}

export type Correlation = {
  symbols: string[];
  matrix: (number | null)[][];
  /** Average pairwise correlation: how much diversification is real vs nominal. */
  average: number | null;
  sessions: number;
};

/**
 * Pairwise correlation of daily returns from the real bhavcopy history.
 *
 * Holding twenty stocks that all move together is one position wearing a disguise. This
 * is the check that reveals it, and it uses actual prices rather than sector labels.
 */
export async function analyseCorrelation(symbols: string[], sessions = 252): Promise<Correlation> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 30);
  const series = await Promise.all(
    uniq.map(async (sym) => {
      try {
        const c = await loadChart(sym, '1y');
        return { sym, points: c.points };
      } catch {
        return null;
      }
    }),
  );

  const usable = series.filter((s) => !!s && s.points.length > 30) as { sym: string; points: { date: string; close: number }[] }[];
  if (usable.length < 2) return { symbols: [], matrix: [], average: null, sessions: 0 };

  // Align on dates present in every series, so correlations are computed over the same
  // days rather than silently comparing different windows.
  const common = usable
    .map((s) => new Set(s.points.map((p) => p.date)))
    .reduce((a, b) => new Set([...a].filter((d) => b.has(d))));
  const dates = [...common].sort().slice(-sessions);

  const returns = usable.map((s) => {
    const byDate = new Map(s.points.map((p) => [p.date, p.close]));
    const closes = dates.map((d) => byDate.get(d)).filter((v): v is number => v != null);
    const r: number[] = [];
    for (let i = 1; i < closes.length; i += 1) {
      if (closes[i - 1] > 0) r.push(closes[i] / closes[i - 1] - 1);
    }
    return r;
  });

  const corr = (a: number[], b: number[]): number | null => {
    const n = Math.min(a.length, b.length);
    if (n < 30) return null;
    const x = a.slice(-n);
    const y = b.slice(-n);
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = x[i] - mx;
      const dy = y[i] - my;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    const den = Math.sqrt(sxx * syy);
    return den > 0 ? sxy / den : null;
  };

  const matrix = returns.map((a) => returns.map((b) => (a === b ? 1 : corr(a, b))));
  const offDiag: number[] = [];
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = i + 1; j < matrix.length; j += 1) {
      const v = matrix[i][j];
      if (v != null) offDiag.push(v);
    }
  }

  return {
    symbols: usable.map((s) => s.sym),
    matrix,
    average: offDiag.length ? offDiag.reduce((a, v) => a + v, 0) / offDiag.length : null,
    sessions: dates.length,
  };
}

// ---------------------------------------------------------------------------
// Risk analytics
// ---------------------------------------------------------------------------

export type RiskContribution = {
  symbol: string;
  weight: number;
  /** Share of total portfolio volatility this holding is responsible for. */
  riskShare: number;
  /** Annualised volatility of the holding itself. */
  vol: number;
};

export type Performance = {
  dates: string[];
  /** Growth of 100 for the basket, and for the equal-weighted market over the same days. */
  portfolio: number[];
  benchmark: number[];
  annualisedVol: number | null;
  benchmarkVol: number | null;
  maxDrawdown: number | null;
  currentDrawdown: number | null;
  beta: number | null;
  /** Return per unit of volatility. Not a Sharpe ratio: no risk-free rate is assumed. */
  returnPerUnitRisk: number | null;
  totalReturn: number | null;
  benchmarkReturn: number | null;
  riskContributions: RiskContribution[];
  /** Pairs that move together closely enough to behave as one position. */
  redundantPairs: { a: string; b: string; correlation: number }[];
  coverage: number;
  sessions: number;
};

const TRADING_DAYS = 252;

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, v) => a + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
}

function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let s = 0;
  for (let i = 0; i < n; i += 1) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}

/**
 * Risk and behaviour of the current basket over real price history.
 *
 * IMPORTANT, and stated in the UI as well: this applies **today's** weights to past
 * prices. It is not what the portfolio actually returned — you did not hold these weights
 * then, and any stock you have since sold is absent. Presenting it as historical
 * performance would be the same hindsight bias this project calls out elsewhere. It is
 * useful for one thing only: showing how this specific mix behaves under real market
 * moves.
 */
export async function analysePerformance(
  holdings: HoldingAnalysis[],
  sessions = TRADING_DAYS,
): Promise<Performance | null> {
  const usable = holdings.filter((h) => h.value != null && h.value > 0 && h.stock);
  if (!usable.length) return null;

  const loaded = await Promise.all(
    usable.map(async (h) => {
      try {
        const c = await loadChart(h.holding.symbol, '2y');
        return { h, points: c.points };
      } catch {
        return null;
      }
    }),
  );
  const ok = loaded.filter((x) => x && x.points.length > 40) as { h: HoldingAnalysis; points: { date: string; close: number; market_return_pct: number | null }[] }[];
  if (!ok.length) return null;

  // Only compare over days every holding actually traded, so one late listing cannot
  // silently shorten or distort the whole series.
  const common = ok
    .map((s) => new Set(s.points.map((p) => p.date)))
    .reduce((a, b) => new Set([...a].filter((d) => b.has(d))));
  const dates = [...common].sort().slice(-sessions);
  if (dates.length < 30) return null;

  const covered = ok.reduce((a, s) => a + (s.h.value ?? 0), 0);
  const totalValue = usable.reduce((a, h) => a + (h.value ?? 0), 0);
  const weights = ok.map((s) => (s.h.value ?? 0) / covered);

  const series = ok.map((s) => {
    const byDate = new Map(s.points.map((p) => [p.date, p.close]));
    return dates.map((d) => byDate.get(d) ?? NaN);
  });
  const returns = series.map((closes) => {
    const r: number[] = [];
    for (let i = 1; i < closes.length; i += 1) {
      r.push(closes[i - 1] > 0 ? closes[i] / closes[i - 1] - 1 : 0);
    }
    return r;
  });

  const marketByDate = new Map(ok[0].points.map((p) => [p.date, p.market_return_pct]));
  const marketLevel = dates.map((d) => {
    const v = marketByDate.get(d);
    return v == null ? null : 1 + v / 100;
  });
  const marketReturns: number[] = [];
  for (let i = 1; i < marketLevel.length; i += 1) {
    const prev = marketLevel[i - 1];
    const cur = marketLevel[i];
    marketReturns.push(prev && cur && prev > 0 ? cur / prev - 1 : 0);
  }

  const portReturns = returns[0].map((_, i) => returns.reduce((a, r, k) => a + r[i] * weights[k], 0));

  const grow = (rs: number[]) => {
    const out = [100];
    for (const r of rs) out.push(out[out.length - 1] * (1 + r));
    return out;
  };
  const portfolio = grow(portReturns);
  const benchmark = grow(marketReturns);

  let peak = portfolio[0];
  let maxDd = 0;
  for (const v of portfolio) {
    peak = Math.max(peak, v);
    maxDd = Math.min(maxDd, v / peak - 1);
  }
  const currentDd = portfolio[portfolio.length - 1] / Math.max(...portfolio) - 1;

  const annVol = stdev(portReturns) * Math.sqrt(TRADING_DAYS);
  const benchVol = stdev(marketReturns) * Math.sqrt(TRADING_DAYS);
  const marketVar = stdev(marketReturns) ** 2;
  const beta = marketVar > 0 ? covariance(portReturns, marketReturns) / marketVar : null;
  const totalReturn = portfolio[portfolio.length - 1] / 100 - 1;
  const benchReturn = benchmark[benchmark.length - 1] / 100 - 1;

  // Marginal contribution to risk: weight x covariance with the portfolio, normalised.
  const portVar = stdev(portReturns) ** 2;
  const riskContributions: RiskContribution[] = ok
    .map((s, i) => ({
      symbol: s.h.holding.symbol,
      weight: weights[i],
      riskShare: portVar > 0 ? (weights[i] * covariance(returns[i], portReturns)) / portVar : 0,
      vol: stdev(returns[i]) * Math.sqrt(TRADING_DAYS),
    }))
    .sort((a, b) => b.riskShare - a.riskShare);

  const redundantPairs: { a: string; b: string; correlation: number }[] = [];
  for (let i = 0; i < returns.length; i += 1) {
    for (let j = i + 1; j < returns.length; j += 1) {
      const sd = stdev(returns[i]) * stdev(returns[j]);
      if (sd <= 0) continue;
      const c = covariance(returns[i], returns[j]) / sd;
      if (c >= 0.8) {
        redundantPairs.push({ a: ok[i].h.holding.symbol, b: ok[j].h.holding.symbol, correlation: c });
      }
    }
  }
  redundantPairs.sort((x, y) => y.correlation - x.correlation);

  return {
    dates,
    portfolio,
    benchmark,
    annualisedVol: annVol || null,
    benchmarkVol: benchVol || null,
    maxDrawdown: maxDd,
    currentDrawdown: currentDd,
    beta,
    returnPerUnitRisk: annVol > 0 ? totalReturn / annVol : null,
    totalReturn,
    benchmarkReturn: benchReturn,
    riskContributions,
    redundantPairs: redundantPairs.slice(0, 5),
    coverage: totalValue > 0 ? covered / totalValue : 0,
    sessions: dates.length,
  };
}

/**
 * Parse pasted holdings.
 *
 * Adding twenty positions one field at a time is the reason most people never finish
 * setting up a portfolio tool. This accepts what a broker actually gives you: CSV or
 * tab-separated rows, with or without a header, in either symbol/qty/price order.
 */
export function parseHoldings(text: string): { holdings: Holding[]; skipped: string[] } {
  const holdings: Holding[] = [];
  const skipped: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/[\t,;|]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      skipped.push(line);
      continue;
    }
    const symbol = parts[0].toUpperCase().replace(/["']/g, '');
    // Header rows and stray text look like everything else, so validate rather than guess.
    if (!/^[A-Z][A-Z0-9&.\-]{1,20}$/.test(symbol)) {
      skipped.push(line);
      continue;
    }
    const nums = parts.slice(1).map((p) => Number(p.replace(/[,₹\s]/g, ''))).filter((n) => Number.isFinite(n));
    if (!nums.length || nums[0] <= 0) {
      skipped.push(line);
      continue;
    }
    holdings.push({ symbol, qty: nums[0], avgPrice: nums.length > 1 && nums[1] > 0 ? nums[1] : null });
  }
  return { holdings, skipped };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type Finding = {
  id: string;
  severity: 'critical' | 'warning' | 'note' | 'good';
  headline: string;
  detail: string;
  symbols?: string[];
};

/**
 * Turn the analysis into ranked, plain-English findings.
 *
 * Twenty correct numbers laid out in identical boxes is not analysis — it leaves the
 * reader to work out which ones matter, which is the job they came here to have done.
 * Each finding therefore states the number, what it means, and why it matters, ordered by
 * how much it should change someone's thinking.
 */
export function deriveFindings(a: PortfolioAnalysis, perf: Performance | null): Finding[] {
  const out: Finding[] = [];
  const pc = (v: number) => `${(v * 100).toFixed(0)}%`;

  const top = a.holdings.filter((h) => h.value != null).sort((x, y) => y.weight - x.weight)[0];

  if (a.concentration.topWeight >= 0.25 && top) {
    out.push({
      id: 'concentration',
      severity: a.concentration.topWeight >= 0.4 ? 'critical' : 'warning',
      headline: `${top.holding.symbol} is ${pc(top.weight)} of your money`,
      detail:
        `A single bad quarter there moves your whole portfolio. Your ${a.holdings.length} positions ` +
        `behave like ${a.concentration.effectiveHoldings.toFixed(1)} equally-sized ones.`,
      symbols: [top.holding.symbol],
    });
  }

  // Risk contribution well above weight is the classic hidden exposure.
  const overweightRisk = perf?.riskContributions.find((r) => r.riskShare > Math.max(r.weight * 1.5, 0.2));
  if (overweightRisk) {
    out.push({
      id: 'risk-driver',
      severity: 'warning',
      headline: `${overweightRisk.symbol} drives ${pc(overweightRisk.riskShare)} of your risk on ${pc(overweightRisk.weight)} of your money`,
      detail:
        'Its price swings more than the rest, so it dominates how the portfolio feels day to day. ' +
        'Size is not the same as exposure.',
      symbols: [overweightRisk.symbol],
    });
  }

  if (perf?.redundantPairs.length) {
    const p = perf.redundantPairs[0];
    out.push({
      id: 'redundant',
      severity: 'warning',
      headline: `${p.a} and ${p.b} move almost identically`,
      detail:
        `Correlation ${p.correlation.toFixed(2)} over the last year. Holding both adds names to the ` +
        'list without adding much diversification.',
      symbols: [p.a, p.b],
    });
  }

  const highRisk = a.holdings.filter((h) => h.stock?.risk_level === 'High');
  if (a.risk.highRiskWeight > 0.15 && highRisk.length) {
    out.push({
      id: 'high-risk',
      severity: 'warning',
      headline: `${pc(a.risk.highRiskWeight)} sits in high-risk names`,
      detail: `Flagged for thin liquidity, volatility or data quality: ${highRisk.map((h) => h.holding.symbol).join(', ')}.`,
      symbols: highRisk.map((h) => h.holding.symbol),
    });
  }

  if (a.liquidity.illiquidWeight > 0.1) {
    const slow = a.holdings
      .filter((h) => (h.daysToExit ?? 0) > 5)
      .map((h) => h.holding.symbol);
    out.push({
      id: 'illiquid',
      severity: 'critical',
      headline: `${pc(a.liquidity.illiquidWeight)} would take over a week to sell`,
      detail: `At 10% of normal daily volume: ${slow.join(', ')}. Exiting faster means moving the price against yourself.`,
      symbols: slow,
    });
  }

  if (a.risk.fnoBanWeight > 0) {
    out.push({
      id: 'fno',
      severity: 'critical',
      headline: `${pc(a.risk.fnoBanWeight)} is in stocks currently under F&O ban`,
      detail: 'The exchange has restricted derivative positions in these, which usually signals elevated speculative activity.',
    });
  }

  if (perf?.beta != null && perf.beta > 1.25) {
    out.push({
      id: 'beta',
      severity: 'note',
      headline: `This mix swings about ${perf.beta.toFixed(1)}x the market`,
      detail: `Annualised volatility ${(perf.annualisedVol! * 100).toFixed(0)}% against the market's ${(perf.benchmarkVol! * 100).toFixed(0)}%. Expect bigger moves both ways.`,
    });
  }

  if (a.risk.technicalOnlyWeight > 0.2) {
    out.push({
      id: 'coverage',
      severity: 'note',
      headline: `${pc(a.risk.technicalOnlyWeight)} has no published fundamentals`,
      detail: 'Those holdings are scored on price behaviour alone, so profitability, debt and valuation are unknown here.',
    });
  }

  const losers = a.holdings.filter((h) => h.pnlPct != null && h.pnlPct < -0.2);
  if (losers.length >= 2) {
    out.push({
      id: 'losers',
      severity: 'note',
      headline: `${losers.length} holdings are down more than 20%`,
      detail: `${losers.map((h) => h.holding.symbol).join(', ')}. Worth checking whether the original reason for buying still holds.`,
      symbols: losers.map((h) => h.holding.symbol),
    });
  }

  // Say what is going right too, or the report reads as uniformly alarming.
  if (a.concentration.effectiveHoldings >= 8 && a.concentration.topWeight < 0.2) {
    out.push({
      id: 'diversified',
      severity: 'good',
      headline: 'Position sizing looks sensible',
      detail: `No holding dominates and the mix behaves like ${a.concentration.effectiveHoldings.toFixed(1)} independent positions.`,
    });
  }
  if (a.liquidity.illiquidWeight === 0 && a.holdings.length > 1) {
    out.push({
      id: 'liquid',
      severity: 'good',
      headline: 'Everything here is easy to exit',
      detail: 'Every holding can be unwound within a session at normal volumes.',
    });
  }

  const rank = { critical: 0, warning: 1, note: 2, good: 3 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
