import { Radar, RadarChart, PolarAngleAxis, PolarGrid, ResponsiveContainer } from 'recharts';
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  Droplets,
  Gauge,
  Info,
  Layers,
  LineChart,
  Percent,
  Scale,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  BASIS_HELP,
  BUCKET_LABEL,
  METRIC_LABELS,
  PILLARS,
  PILLAR_HELP,
  formatCrore,
  formatMetric,
  formatTurnover,
  scoreBg,
  scoreColor,
  type Pillar,
  type Screen,
  type Stock,
} from './types';

const FLAG_HELP: Record<string, string> = {
  negative_equity:
    'Book equity is negative, so return on equity and debt/equity are meaningless here — a loss-making firm with negative equity produces a misleadingly large positive ROE. Both were suppressed.',
  implausible_operating_margin:
    'Reported operating profit exceeded revenue, which cannot happen in normal operations. The line contains a one-off item (waiver, asset sale, tax writeback), so the ratio was suppressed.',
  implausible_net_margin:
    'Net margin was outside ±100%, indicating an exceptional item rather than trading performance. Suppressed.',
  net_margin_unreliable:
    'Net margin came from the same statements that produced an implausible operating figure, or exceeded operating margin. Suppressed as untrustworthy.',
};

type MetricSpec = {
  label: string;
  value: number | null;
  kind?: 'percent' | 'pctPoint' | 'ratio' | 'currency' | 'price' | 'integer' | 'plain';
  muted?: boolean;
};

function exists(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && !Number.isNaN(v);
}

function formatValue(v: number | null | undefined, kind: MetricSpec['kind'] = 'plain') {
  if (!exists(v)) return '—';
  if (kind === 'percent') return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  if (kind === 'pctPoint') return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  if (kind === 'ratio') return `${v.toFixed(2)}x`;
  if (kind === 'currency') return formatCrore(v);
  if (kind === 'price') return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  if (kind === 'integer') return Math.round(v).toLocaleString('en-IN');
  return v.toFixed(2);
}

function percentileText(v: number | null | undefined) {
  if (!exists(v)) return '—';
  if (v >= 99.5) return 'Top percentile';
  if (v <= 0.5) return 'Bottom percentile';
  return `${v.toFixed(0)}th percentile`;
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Activity;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/35">
      <div className="flex items-start gap-2 border-b border-slate-800 px-4 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-slate-500" />
        <div>
          <h3 className="text-sm font-medium text-slate-200">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium tabular-nums text-slate-100">{value}</div>
      {hint && <div className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</div>}
    </div>
  );
}

function MetricGrid({ items }: { items: MetricSpec[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((m) => (
        <div key={m.label} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">{m.label}</dt>
          <dd className={`mt-1 text-sm font-medium tabular-nums ${m.muted ? 'text-slate-500' : 'text-slate-100'}`}>
            {formatValue(m.value, m.kind)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PillarScore({
  pillar,
  stock,
  weight,
}: {
  pillar: Pillar;
  stock: Stock;
  weight: number;
}) {
  const score = stock[pillar];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-sm font-medium capitalize text-slate-200">{pillar}</div>
        <span className={`text-sm font-semibold tabular-nums ${scoreColor(score)}`}>
          {score?.toFixed(0) ?? 'n/a'}
          <span className="ml-1 text-xs font-normal text-slate-600">×{(weight * 100).toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${scoreBg(score)}`} style={{ width: `${Math.max(0, score ?? 0)}%` }} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{PILLAR_HELP[pillar]}</p>
    </div>
  );
}

export function StockDetail({
  stock,
  screen,
  onClose,
}: {
  stock: Stock;
  screen: Screen;
  onClose: () => void;
}) {
  const peerCount = screen.stocks.filter((x) => x.rating_basis === stock.rating_basis && x.bucket === stock.bucket).length;
  const flags = (stock.data_flags ?? '').split(',').filter(Boolean);
  const bucketLabel = stock.bucket ? BUCKET_LABEL[stock.bucket] : 'Unknown';
  const positionShare = exists(stock.turnover_median) && stock.turnover_median > 0 ? 1e5 / stock.turnover_median : null;
  const price = exists(stock.price) ? `₹${stock.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';

  const radar = PILLARS.filter((p) => stock[p] != null).map((p) => ({
    pillar: p.charAt(0).toUpperCase() + p.slice(1),
    value: stock[p] ?? 0,
  }));

  const valuation: MetricSpec[] = [
    { label: 'Market cap', value: stock.market_cap, kind: 'currency' },
    { label: 'Current price', value: stock.price, kind: 'price' },
    { label: 'P / E', value: stock.pe },
    { label: 'P / B', value: stock.pb },
    { label: 'EV / EBITDA', value: stock.ev_ebitda },
    { label: 'Dividend yield', value: stock.dividend_yield, kind: 'pctPoint' },
  ];

  const profitability: MetricSpec[] = [
    { label: 'Return on equity', value: stock.roe, kind: 'percent' },
    { label: 'Return on assets', value: stock.roa, kind: 'percent' },
    { label: 'Operating margin', value: stock.operating_margin, kind: 'percent' },
    { label: 'Net margin', value: stock.net_margin, kind: 'percent' },
    { label: 'Debt / equity', value: stock.debt_to_equity },
    { label: 'Financial years', value: stock.years_of_data, kind: 'integer' },
  ];

  const growth: MetricSpec[] = [
    { label: 'Revenue CAGR', value: stock.revenue_cagr, kind: 'percent' },
    { label: 'Earnings CAGR', value: stock.earnings_cagr, kind: 'percent' },
    { label: '6m return', value: stock.ret_6m, kind: 'percent' },
    { label: '12m return', value: stock.ret_12m, kind: 'percent' },
    { label: 'Annual volatility', value: stock.ann_vol, kind: 'percent' },
    { label: 'RS vs Nifty', value: stock.rs_vs_nifty, kind: 'percent' },
  ];

  const technicals: MetricSpec[] = [
    { label: 'vs 50 DMA', value: stock.above_50dma, kind: 'pctPoint' },
    { label: 'vs 200 DMA', value: stock.above_200dma, kind: 'pctPoint' },
    { label: 'From 52w high', value: stock.dist_52w_high, kind: 'pctPoint' },
    { label: '6m risk-adj momentum', value: stock.mom_6m_risk_adj },
    { label: '12m risk-adj momentum', value: stock.mom_12m_risk_adj },
    { label: 'Sessions', value: stock.sessions, kind: 'integer' },
  ];

  return (
    <aside className="flex h-full min-w-0 flex-col self-start overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      <header className="border-b border-slate-800 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-100">{stock.symbol}</h2>
              <span className="rounded bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-teal-300">
                {bucketLabel}
              </span>
              {stock.rating_basis === 'technical only' && (
                <span className="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-300">
                  <LineChart className="size-3" />
                  technical only
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-slate-300">{stock.name}</p>
            <p className="mt-1 text-xs text-slate-500">
              {stock.sector ?? 'Unknown sector'} · {price}
              {stock.market_cap ? ` · ${formatCrore(stock.market_cap)}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300">
            <X className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        <section className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="flex items-center gap-3">
              <span className={`text-5xl font-bold tabular-nums ${scoreColor(stock.composite)}`}>
                {stock.composite?.toFixed(0) ?? '—'}
              </span>
              <div>
                <div className="text-sm font-medium text-slate-200">{stock.band ?? 'Not rated'}</div>
                <div className="text-xs text-slate-500">{percentileText(stock.composite)}</div>
                {stock.composite_raw != null && (
                  <div className="text-xs text-slate-600">raw average {stock.composite_raw.toFixed(1)}</div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Peer group" value={`${peerCount.toLocaleString('en-IN')} stocks`} hint={`${bucketLabel}-cap, same rating basis`} />
              <MiniStat label="Data coverage" value={`${((stock.coverage ?? 0) * 100).toFixed(0)}%`} hint={`${stock.pillars_used ?? 0} of 5 pillars used`} />
              <MiniStat label="Median turnover" value={formatTurnover(stock.turnover_median)} hint="NSE traded value/day" />
              <MiniStat label="Trades/day" value={formatValue(stock.trades_median, 'integer')} hint="Median number of trades" />
            </div>
          </div>
          <p className="mt-3 border-t border-slate-800 pt-3 text-xs leading-relaxed text-slate-500">
            This describes what the company looks like now — not what the share price will do next.
          </p>
        </section>

        {stock.rating_basis === 'technical only' && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-amber-200">
              <LineChart className="size-4" /> Technical only — no fundamentals
            </div>
            <p className="text-xs leading-relaxed text-slate-400">{BASIS_HELP['technical only']}</p>
          </div>
        )}

        {flags.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-amber-200">
              <TriangleAlert className="size-4" /> Data quality flags
            </div>
            <ul className="space-y-1.5">
              {flags.map((f) => (
                <li key={f} className="text-xs leading-relaxed text-slate-400">
                  <span className="font-mono text-amber-300/80">{f}</span> — {FLAG_HELP[f] ?? 'Value suppressed.'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Section icon={Building2} title="Company facts" subtitle="Screener-style quick snapshot from the current cached public data.">
          <MetricGrid
            items={[
              { label: 'Market cap', value: stock.market_cap, kind: 'currency' },
              { label: 'Current price', value: stock.price, kind: 'price' },
              { label: 'Financial years', value: stock.years_of_data, kind: 'integer' },
              { label: 'History sessions', value: stock.sessions, kind: 'integer' },
              { label: 'Coverage', value: stock.coverage, kind: 'percent' },
            ]}
          />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Sector</div>
              <div className="mt-1 text-sm text-slate-100">{stock.sector ?? 'Unknown'}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Peer bucket</div>
              <div className="mt-1 text-sm text-slate-100">{bucketLabel}</div>
            </div>
          </div>
        </Section>

        <Section icon={Scale} title="Valuation" subtitle="Cheaper can be attractive, or it can be the market pricing in real trouble.">
          <MetricGrid items={valuation} />
        </Section>

        <Section icon={Percent} title="Profitability and growth" subtitle="Backward-looking statement ratios. These are not forecasts.">
          <MetricGrid items={profitability} />
          <div className="mt-2">
            <MetricGrid items={growth.slice(0, 2)} />
          </div>
        </Section>

        <Section icon={Activity} title="Returns and technicals" subtitle={`Measured through ${screen.last_trading_session}.`}>
          <MetricGrid items={growth.slice(2)} />
          <div className="mt-2">
            <MetricGrid items={technicals} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            DMA and 52-week values below are percentage-point distances from the current price.
          </p>
        </Section>

        <Section icon={Droplets} title="Liquidity and position size" subtitle="A great-looking percentile is useless if you cannot enter and exit without moving the price.">
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat label="Median turnover" value={formatTurnover(stock.turnover_median)} />
            <MiniStat label="Median trades" value={formatValue(stock.trades_median, 'integer')} />
            <MiniStat label="Sessions" value={formatValue(stock.sessions, 'integer')} />
          </div>
          {positionShare != null && (
            <p className={`mt-3 text-xs leading-relaxed ${positionShare > 0.01 ? 'text-amber-300/90' : 'text-slate-500'}`}>
              A ₹1 lakh position is <span className="font-medium">{(positionShare * 100).toFixed(2)}%</span> of a typical day's
              trading
              {positionShare > 0.01
                ? ' — large enough that your own buying and selling can move the price against you.'
                : '.'}
            </p>
          )}
        </Section>

        <Section icon={Gauge} title="Scorecard" subtitle="Every factor score is a percentile rank against comparable peers, not a buy/sell call.">
          <div className="space-y-4">
            {PILLARS.map((p) => (
              <PillarScore key={p} pillar={p} stock={stock} weight={screen.weights[p] ?? 0} />
            ))}
          </div>
        </Section>

        {radar.length >= 3 && (
          <Section icon={BarChart3} title="Factor shape" subtitle="The same five scores in radar form.">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radar} outerRadius="72%">
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="pillar" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Radar dataKey="value" stroke="#2dd4bf" fill="#2dd4bf" fillOpacity={0.25} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        )}

        <Section icon={Layers} title="Raw inputs by pillar" subtitle="The numbers below are the inputs used to build the score.">
          <div className="space-y-4">
            {PILLARS.map((p: Pillar) => (
              <div key={p}>
                <div className="mb-2 flex items-baseline justify-between">
                  <div className="text-sm font-medium capitalize text-slate-200">{p}</div>
                  <span className={`text-sm font-semibold tabular-nums ${scoreColor(stock[p])}`}>
                    {stock[p]?.toFixed(0) ?? 'n/a'}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {(screen.metrics[p] ?? []).map((m) => (
                    <div key={m} className="flex justify-between border-b border-slate-800/50 py-1">
                      <dt className="text-xs text-slate-500">{METRIC_LABELS[m] ?? m}</dt>
                      <dd className="text-xs tabular-nums text-slate-300">
                        {formatMetric(m, (stock as unknown as Record<string, number | null>)[m])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={CalendarDays} title="What is still not here" subtitle="Screener.in has licensed / scraped pages we should not copy blindly.">
          <p className="text-xs leading-relaxed text-slate-500">
            This panel now shows every fundamental, technical, liquidity and data-quality field currently available in
            market-lab's public-data cache. It still does not include quarterly P&L tables, balance sheet line items,
            cash-flow statements, shareholding patterns, concalls or annual reports. Those need separate, source-specific
            ingestion before they can be shown honestly.
          </p>
        </Section>

        <p className="flex gap-2 text-xs leading-relaxed text-slate-500">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            These are measured characteristics as of {screen.last_trading_session}, ranked against same-size peers on
            that date. They describe what this company looks like now — not what the share price will do next. High
            scores have no predictive guarantee.
          </span>
        </p>
      </div>
    </aside>
  );
}
