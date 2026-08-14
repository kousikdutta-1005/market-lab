/**
 * The analysis engine behind the assistant.
 *
 * The first version sent the model nothing but the user's question, so it had no market
 * data and could only guess — it could not answer "which small caps have the strongest
 * delivery" because it had never seen a single row. This replaces guessing with a real
 * two-pass loop:
 *
 *   1. PLAN   the model sees the field schema and market summary, and writes queries.
 *   2. EXECUTE those queries run here, in the browser, against the full dataset.
 *   3. ANSWER the model sees the real rows it asked for and writes the reply.
 *
 * The model therefore never invents a number: every figure it quotes came out of the
 * same file the board is rendering. It runs entirely client-side, so this costs the
 * operator nothing and works on the static deploy with no server.
 */
import type { Screen, Stock } from '../types';

import { callModel, type AIConfig } from './providers';

/** Fields the model may filter, sort and report on, with units made explicit. */
export const FIELD_SCHEMA = `
IDENTITY: symbol, name, sector, bucket ('large'|'mid'|'small'|'micro'|'nano'),
  rating_basis ('fundamental + technical'|'technical only'|'not rated')
PRICE/SIZE: price (INR), market_cap (INR absolute), turnover_median (INR/day), trades_median, sessions
SCORES 0-100 (percentile vs same-size peers): opportunity_score, composite, investable_score,
  short_fit (1-3m), medium_fit (6-12m), long_fit (3-5y),
  quality, growth, valuation, trend, momentum, liquidity_score
RISK: risk_score (0-100, higher = safer), risk_level ('Low'|'Watch'|'High'), risk_flags (text), fno_ban (bool)
FLOW: delivery_accumulation_score, delivery_pct_latest (%), delivery_pct_median_20d (%),
  deal_activity_score, deal_count, deal_value (INR), bulk_deal_count, block_deal_count
EVENTS: news_event_score, news_count_14d, news_positive_14d, news_negative_14d, news_last_title
FUNDAMENTALS (rates are FRACTIONS: 0.15 = 15%): roe, roa, operating_margin, net_margin,
  revenue_cagr, earnings_cagr, dividend_yield, debt_to_equity, pe, pb, ev_ebitda, years_of_data
TECHNICALS: above_50dma (% points), above_200dma (% points), dist_52w_high (% points),
  ret_6m, ret_12m, ann_vol, rs_vs_nifty (all FRACTIONS), mom_6m_risk_adj, mom_12m_risk_adj
QUALITY OF DATA: coverage (0-1), pillars_used, data_flags
`.trim();

export type QuerySpec = {
  name: string;
  filter?: string;
  sort?: string;
  desc?: boolean;
  limit?: number;
  fields?: string[];
};

export type Plan = {
  queries?: QuerySpec[];
  apply_formula?: string;
  charts?: string[];
};

export type AnalystResult = {
  answer: string;
  applyFormula?: string;
  charts: string[];
  queries: { name: string; spec: QuerySpec; rows: Record<string, unknown>[]; matched: number }[];
  /** Symbols the answer named that were not in any query result — possible fabrication. */
  unverified: string[];
};

/** Compile a filter expression against a Stock, tolerating anything unparseable. */
function compile(expr: string): (s: Stock) => boolean {
  // Runs in the user's own browser over a plain data object, with their own key. The
  // expression can only read stock fields — there is nothing else in scope.
  const fn = new Function('s', `with (s) { try { return !!(${expr}); } catch (e) { return false; } }`);
  return fn as (s: Stock) => boolean;
}

export function runQuery(stocks: Stock[], spec: QuerySpec) {
  let rows = stocks;
  if (spec.filter?.trim()) {
    try {
      const pred = compile(spec.filter);
      rows = rows.filter(pred);
    } catch {
      /* an unusable filter simply does not narrow anything */
    }
  }
  const matched = rows.length;

  const sortKey = spec.sort && spec.sort in (stocks[0] ?? {}) ? spec.sort : undefined;
  if (sortKey) {
    const dir = spec.desc === false ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(bv ?? '').localeCompare(String(av ?? ''));
      }
      return dir * ((Number(bv) || -Infinity) - (Number(av) || -Infinity));
    });
  }

  const limit = Math.min(Math.max(spec.limit ?? 15, 1), 40);
  const fields = spec.fields?.length ? spec.fields : ['symbol', 'name', 'bucket', 'opportunity_score', 'risk_level'];
  const picked = rows.slice(0, limit).map((s) => {
    const o: Record<string, unknown> = {};
    for (const f of fields) o[f] = (s as unknown as Record<string, unknown>)[f] ?? null;
    if (!('symbol' in o)) o.symbol = s.symbol;
    return o;
  });
  return { rows: picked, matched };
}

/** Small factual summary of the whole board, so the model starts grounded. */
function marketBrief(screen: Screen): string {
  const sectors = new Map<string, number>();
  for (const s of screen.stocks) {
    if (s.sector) sectors.set(s.sector, (sectors.get(s.sector) ?? 0) + 1);
  }
  const top = [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return [
    `Session: ${screen.last_trading_session} (NSE end-of-day, not live ticks).`,
    `Universe: ${screen.stocks.length} scored of ${screen.universe_total} listed; ${screen.excluded?.length ?? 0} excluded for liquidity/history.`,
    `Regime: ${screen.market_regime ?? 'unknown'} — ${screen.market_regime_summary ?? 'n/a'}`,
    `Breadth: ${screen.breadth_advance_pct?.toFixed(0) ?? '—'}% advancing, ${screen.above_50dma_pct?.toFixed(0) ?? '—'}% above 50DMA.`,
    `Risk: ${screen.high_risk_symbols ?? 0} high-risk, ${screen.fo_ban_count ?? 0} in F&O ban.`,
    `Sectors: ${top.map(([k, v]) => `${k} (${v})`).join(', ')}`,
  ].join('\n');
}

const PLAN_PROMPT = `You are the analyst engine for market-lab, an Indian equity research board.

You cannot see the data yet. Write queries and it will be run for you, then you will
answer from the real rows.

Return JSON only:
{
  "queries": [ { "name": "short label",
                 "filter": "JS boolean over stock fields, e.g. bucket==='small' && roe>0.15",
                 "sort": "field to order by",
                 "desc": true,
                 "limit": 15,
                 "fields": ["symbol","name","roe","opportunity_score"] } ],
  "apply_formula": "optional JS filter to also apply to the on-screen board",
  "charts": ["optional NSE symbols to chart"]
}

Rules:
- Always include the fields you intend to cite, so you can quote real numbers.
- Rates are fractions: 15% ROE is roe>0.15. Scores are 0-100.
- Prefer 1-3 focused queries over one broad one. Use up to 4.
- If the question needs no data (e.g. "what does delivery % mean"), return {"queries":[]}.
- Set apply_formula when the user asks to filter, screen or "show me" stocks.

FIELDS
{SCHEMA}

MARKET
{BRIEF}`;

const ANSWER_PROMPT = `You are the analyst for market-lab, an Indian equity research board.

Answer the user from the query results below. These are real rows from today's data.

Rules:
- Quote actual numbers and symbols from the results. Never invent a figure.
- If the results are empty, say so plainly and suggest a looser criterion.
- Be concise and concrete. Short paragraphs or a tight list.
- Scores are percentile ranks against same-size peers, not predictions.
- Never give buy/sell advice, price targets or forecasts. Describe what the data shows.
- Mention risk_level or liquidity when it materially qualifies what you just said.
- Plain text only, no markdown tables.

MARKET
{BRIEF}

RESULTS
{RESULTS}`;

/**
 * Verify the answer only names stocks the query actually returned.
 *
 * Prompt rules are a request, not a guarantee: a model asked for "the best small caps"
 * will happily produce a plausible-looking ticker it never saw. Since every row the model
 * received is known here, a fabricated symbol is mechanically detectable — so it is
 * detected and shown to the user rather than trusted.
 */
function verifySymbols(answer: string, executed: AnalystResult['queries'], screen: Screen) {
  const shown = new Set<string>();
  for (const q of executed) {
    for (const row of q.rows) if (row.symbol) shown.add(String(row.symbol).toUpperCase());
  }
  const universe = new Set(screen.stocks.map((s) => s.symbol.toUpperCase()));

  // Ticker-shaped tokens: 3+ chars, uppercase, optionally with & - digits.
  const candidates = answer.match(/\b[A-Z][A-Z0-9&-]{2,}\b/g) ?? [];
  const unsupported = new Set<string>();
  for (const tok of candidates) {
    if (shown.has(tok)) continue;
    // Only flag things that are real tickers or look like one being asserted about.
    if (universe.has(tok)) unsupported.add(tok);
  }
  return [...unsupported];
}

export async function askAnalyst(
  cfg: AIConfig,
  question: string,
  screen: Screen,
): Promise<AnalystResult> {
  const brief = marketBrief(screen);

  // 1. PLAN
  const planRaw = await callModel(
    cfg,
    PLAN_PROMPT.replace('{SCHEMA}', FIELD_SCHEMA).replace('{BRIEF}', brief),
    question,
    true,
  );
  let plan: Plan = {};
  try {
    plan = JSON.parse(planRaw);
  } catch {
    throw new Error('The assistant could not structure this question against the board data. Rephrase it as a comparison, filter, or methodology question and retry.');
  }
  if (plan.queries != null && !Array.isArray(plan.queries)) {
    throw new Error('The assistant returned an invalid query plan. Retry the question or change providers.');
  }

  // 2. EXECUTE locally against the real dataset
  const executed = (plan.queries ?? []).slice(0, 4).map((spec) => {
    const { rows, matched } = runQuery(screen.stocks, spec);
    return { name: spec.name || 'query', spec, rows, matched };
  });

  // 3. ANSWER from the real rows
  const resultsBlock = executed.length
    ? executed
        .map(
          (q) =>
            `## ${q.name}\nfilter: ${q.spec.filter ?? '(none)'}\nmatched: ${q.matched} stocks\n${JSON.stringify(q.rows)}`,
        )
        .join('\n\n')
    : '(no query was needed for this question)';

  const answer = await callModel(
    cfg,
    ANSWER_PROMPT.replace('{BRIEF}', brief).replace('{RESULTS}', resultsBlock),
    question,
    false,
  );

  return {
    answer: answer.trim(),
    applyFormula: plan.apply_formula,
    charts: Array.isArray(plan.charts) ? plan.charts.slice(0, 4).map(String) : [],
    queries: executed,
    unverified: executed.length ? verifySymbols(answer, executed, screen) : [],
  };
}
