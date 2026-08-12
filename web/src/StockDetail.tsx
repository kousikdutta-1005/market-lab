import { useEffect, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Radar,
  RadarChart,
  PolarAngleAxis,
  PolarGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  Droplets,
  Gauge,
  Info,
  Layers,
  LineChart as LineChartIcon,
  Percent,
  Scale,
  ShieldAlert,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { SegmentedControl } from './SegmentedControl';
import { OwnershipBadge } from './OwnershipBadge';
import {
  BASIS_HELP,
  BUCKET_LABEL,
  METRIC_LABELS,
  HORIZONS,
  HORIZON_LABEL,
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
  type StockChartResponse,
} from './types';
import { loadChart } from '@/lib/dataSource';

const CHART_RANGES = ['3m', '6m', '1y', '2y'] as const;

const PANES = [
  { key: 'overview', label: 'Overview' },
  { key: 'risk', label: 'Risk & flow' },
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'technicals', label: 'Technicals' },
  { key: 'audit', label: 'Audit' },
] as const;
type PaneKey = (typeof PANES)[number]['key'];
type ChartRange = (typeof CHART_RANGES)[number];

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

function shortDate(value: string) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function tooltipValue(value: unknown, name: unknown) {
  const n = String(name);
  const v = Number(value);
  if (!Number.isFinite(v)) return ['—', n];
  if (n === 'Turnover') return [formatTurnover(v), n];
  return [`₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, n];
}

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
    <Card>
      <CardHeader className="flex-row items-start gap-2 border-b">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="font-heading text-sm font-medium text-foreground">{title}</h3>
          {subtitle && <CardDescription className="mt-0.5 text-xs leading-relaxed">{subtitle}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-sm font-medium tabular-nums text-foreground">{value}</div>
        {hint && <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function MetricGrid({ items }: { items: MetricSpec[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((m) => (
        <Card key={m.label} size="sm">
          <CardContent>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</dt>
          <dd className={`mt-1 text-sm font-medium tabular-nums ${m.muted ? 'text-muted-foreground' : 'text-foreground'}`}>
            {formatValue(m.value, m.kind)}
          </dd>
          </CardContent>
        </Card>
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
        <div className="text-sm font-medium capitalize text-foreground">{pillar}</div>
        <span className={`text-sm font-semibold tabular-nums ${scoreColor(score)}`}>
          {score?.toFixed(0) ?? 'n/a'}
          <span className="ml-1 text-xs font-normal text-muted-foreground">×{(weight * 100).toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${scoreBg(score)}`} style={{ width: `${Math.max(0, score ?? 0)}%` }} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{PILLAR_HELP[pillar]}</p>
    </div>
  );
}

export function StockDetail({
  stock,
  screen,
  onClose,
  variant = 'desktop',
}: {
  stock: Stock;
  screen: Screen;
  onClose: () => void;
  variant?: 'desktop' | 'sheet';
}) {
  // The factsheet carries the full audit trail, which is ~7 screens of scrolling in one
  // column. Grouping it into panes puts the answer first and keeps the evidence one tap
  // away, without removing anything.
  const [pane, setPane] = useState<PaneKey>('overview');
  const [chartRange, setChartRange] = useState<ChartRange>('1y');
  const [chart, setChart] = useState<StockChartResponse | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const peerCount = screen.stocks.filter((x) => x.rating_basis === stock.rating_basis && x.bucket === stock.bucket).length;
  const flags = (stock.data_flags ?? '').split(',').filter(Boolean);
  const bucketLabel = stock.bucket ? BUCKET_LABEL[stock.bucket] : 'Unknown';
  const positionShare = exists(stock.turnover_median) && stock.turnover_median > 0 ? 1e5 / stock.turnover_median : null;
  const price = exists(stock.price) ? `₹${stock.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';

  const radar = PILLARS.filter((p) => stock[p] != null).map((p) => ({
    pillar: p.charAt(0).toUpperCase() + p.slice(1),
    value: stock[p] ?? 0,
  }));
  const lastChartPoint = chart?.points.length ? chart.points[chart.points.length - 1] : null;
  const firstChartPoint = chart?.points.length ? chart.points[0] : null;
  const shellClass =
    variant === 'sheet'
      ? 'flex h-full min-w-0 flex-col overflow-hidden bg-card'
      : 'flex h-full min-w-0 flex-col self-start overflow-hidden rounded-xl border bg-card xl:sticky xl:top-[88px] xl:max-h-[calc(100vh-6rem)]';

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    loadChart(stock.symbol, chartRange)
      .then((data) => {
        if (!cancelled) setChart(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setChart(null);
          setChartError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stock.symbol, chartRange]);

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
    <aside className={shellClass}>
      <header className="border-b p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-foreground">{stock.symbol}</h2>
              <Badge variant="secondary">
                {bucketLabel}
              </Badge>
              {stock.rating_basis === 'technical only' && (
                <Badge variant="outline" className="border-warning/30 bg-warning-subtle text-warning hover:bg-warning-subtle">
                 <LineChartIcon className="size-3" />
                  technical only
                </Badge>
              )}
              <OwnershipBadge stock={stock} />
            </div>
            <p className="mt-1 truncate text-sm text-foreground">{stock.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stock.sector ?? 'Unknown sector'} · {price}
              {stock.market_cap ? ` · ${formatCrore(stock.market_cap)}` : ''}
            </p>
            <div className="mt-2 flex gap-3">
              <a href={`https://www.screener.in/company/${stock.symbol.replace('-EQ', '')}/`} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">Screener.in</a>
              <a href={`https://in.tradingview.com/chart/?symbol=NSE:${stock.symbol.replace('-EQ', '')}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">TradingView</a>
            </div>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon-sm" aria-label="Close factsheet">
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
        <Card>
          <CardContent>
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="flex items-center gap-3">
              <span className={`text-5xl font-bold tabular-nums ${scoreColor(stock.composite)}`}>
                {stock.composite?.toFixed(0) ?? '—'}
              </span>
              <div>
                <div className="text-sm font-medium text-foreground">{stock.band ?? 'Not rated'}</div>
                <div className="text-xs text-muted-foreground">{percentileText(stock.composite)}</div>
                {stock.composite_raw != null && (
                  <div className="text-xs text-muted-foreground">raw average {stock.composite_raw.toFixed(1)}</div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Research score" value={stock.opportunity_score?.toFixed(0) ?? '—'} hint="Fit + flows − risk" />
              <MiniStat label="Peer group" value={`${peerCount.toLocaleString('en-IN')} stocks`} hint={`${bucketLabel}-cap, same rating basis`} />
              <MiniStat label="Data coverage" value={`${((stock.coverage ?? 0) * 100).toFixed(0)}%`} hint={`${stock.pillars_used ?? 0} of 5 pillars used`} />
              <MiniStat label="Median turnover" value={formatTurnover(stock.turnover_median)} hint="NSE traded value/day" />
              <MiniStat label="Trades/day" value={formatValue(stock.trades_median, 'integer')} hint="Median number of trades" />
            </div>
          </div>
          <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
            This describes what the company looks like now — not what the share price will do next.
          </p>
          </CardContent>
        </Card>

        {stock.rating_basis === 'technical only' && (
          <Card className="border-warning/30 bg-warning-subtle">
            <CardContent>
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-warning">
              <LineChartIcon className="size-4" /> Technical only — no fundamentals
            </div>
            <p className="text-xs leading-relaxed text-warning">{BASIS_HELP['technical only']}</p>
            </CardContent>
          </Card>
        )}

        {flags.length > 0 && (
          <Card className="border-warning/30 bg-warning-subtle">
            <CardContent>
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-warning">
              <TriangleAlert className="size-4" /> Data quality flags
            </div>
            <ul className="space-y-1.5">
              {flags.map((f) => (
                <li key={f} className="text-xs leading-relaxed text-warning">
                  <span className="font-mono text-warning">{f}</span> — {FLAG_HELP[f] ?? 'Value suppressed.'}
                </li>
              ))}
            </ul>
            </CardContent>
          </Card>
        )}

        <SegmentedControl
          label="Factsheet section"
          value={pane}
          onChange={setPane}
          size="sm"
          items={PANES.map((t) => ({ value: t.key, label: t.label }))}
        />

        {pane === 'overview' && (<>
        {(stock.sast_events_180d ?? 0) > 0 && stock.sast_latest_holder && (
          <Card size="sm">
            <CardContent>
              <div className="flex items-start gap-2">
                <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="t-body font-medium text-foreground">
                    {stock.sast_latest_holder} {stock.sast_latest_action}
                    {stock.sast_latest_stake != null && ` — now holds ${stock.sast_latest_stake.toFixed(2)}%`}
                  </div>
                  <div className="t-meta text-muted-foreground">
                    {stock.sast_events_180d} large-holder filing{(stock.sast_events_180d ?? 0) === 1 ? '' : 's'} in 180 days
                    {stock.sast_latest_date ? ` · latest ${stock.sast_latest_date}` : ''} · see Risk &amp; flow for detail
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        <Section
          icon={BarChart3}
          title="Price, trend and participation"
          subtitle={`Exchange EOD chart from NSE bhavcopy. Latest point: ${chart?.last_date ?? screen.last_trading_session}.`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="Chart range"
              value={chartRange}
              onChange={setChartRange}
              size="sm"
              className="w-full sm:w-auto"
              items={CHART_RANGES.map((r) => ({ value: r, label: r.toUpperCase() }))}
            />
            <div className="text-xs text-muted-foreground">{chart?.source ?? 'Loading local price cache'}</div>
          </div>

          {chartLoading && <div className="grid h-60 place-items-center text-sm text-muted-foreground">Loading chart…</div>}
          {!chartLoading && chartError && (
            <div className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning">
              Chart unavailable: {chartError}
            </div>
          )}
          {!chartLoading && chart && chart.points.length > 0 && (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                      minTickGap={24}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="price"
                      domain={['auto', 'auto']}
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                      tickFormatter={(v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                      tickLine={false}
                      width={56}
                    />
                    <YAxis yAxisId="turnover" orientation="right" hide />
                    <Tooltip
                      formatter={tooltipValue}
                      labelFormatter={(label: unknown) => shortDate(String(label))}
                      contentStyle={{
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        background: 'var(--popover)',
                        color: 'var(--popover-foreground)',
                        boxShadow: '0 12px 34px rgb(0 0 0 / 0.12)',
                      }}
                    />
                    <Bar yAxisId="turnover" dataKey="turnover" name="Turnover" fill="var(--chart-2)" radius={[4, 4, 0, 0]} opacity={0.55} />
                    <Line yAxisId="price" type="monotone" dataKey="close" name="Close" stroke="var(--primary)" strokeWidth={2.4} dot={false} />
                    <Line yAxisId="price" type="monotone" dataKey="ma50" name="50 DMA" stroke="var(--success)" strokeWidth={1.6} dot={false} connectNulls />
                    <Line yAxisId="price" type="monotone" dataKey="ma200" name="200 DMA" stroke="var(--warning)" strokeWidth={1.6} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <MiniStat
                  label="Range move"
                  value={lastChartPoint?.return_pct != null ? `${lastChartPoint.return_pct >= 0 ? '+' : ''}${lastChartPoint.return_pct.toFixed(1)}%` : '—'}
                  hint={firstChartPoint ? `Since ${shortDate(firstChartPoint.date)}` : undefined}
                />
                <MiniStat
                  label="Market move"
                  value={lastChartPoint?.market_return_pct != null ? `${lastChartPoint.market_return_pct >= 0 ? '+' : ''}${lastChartPoint.market_return_pct.toFixed(1)}%` : '—'}
                  hint="Equal-weighted NSE bhavcopy universe"
                />
                <MiniStat
                  label="Last turnover"
                  value={formatTurnover(lastChartPoint?.turnover ?? null)}
                  hint={lastChartPoint ? shortDate(lastChartPoint.date) : undefined}
                />
              </div>
            </>
          )}
        </Section>

        <Section icon={Gauge} title="Research fit by horizon" subtitle="Weighted research rankings, not personal advice or a buy/sell call.">
          <div className="grid gap-2 sm:grid-cols-3">
            {HORIZONS.map((h) => (
              <Card
                key={h.key}
                className={
                  stock.best_horizon === h.key
                    ? 'border-primary/40 bg-primary/5'
                    : ''
                }
                size="sm"
              >
                <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{h.label}</div>
                  {stock.best_horizon === h.key && (
                    <Badge variant="secondary">
                      best fit
                    </Badge>
                  )}
                </div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums ${scoreColor(stock[h.scoreKey])}`}>
                  {stock[h.scoreKey]?.toFixed(0) ?? '—'}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{h.detail}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Scores highest over <span className="text-foreground">{stock.best_horizon ? HORIZON_LABEL[stock.best_horizon] : '—'}</span>.
            The score combines fundamentals, technicals, liquidity and official NSE/BSE events.
            It describes which horizon this company's measured characteristics fit best — not
            how long anyone should hold it.
          </p>
        </Section>

        </>)}

        {pane === 'risk' && (<>
        <Section icon={ShieldAlert} title="Risk lens" subtitle="A high score is not useful if the stock is hard to trade, under restriction, or full of bad data.">
          <div className="grid gap-2 sm:grid-cols-4">
            <MiniStat label="Risk level" value={stock.risk_level ?? '—'} />
            <MiniStat label="Risk score" value={stock.risk_score?.toFixed(0) ?? '—'} />
            <MiniStat label="F&O ban" value={stock.fno_ban ? 'Yes' : 'No'} />
            <MiniStat label="Flags" value={(stock.risk_flags ? stock.risk_flags.split(',').length : 0).toLocaleString('en-IN')} />
          </div>
          {stock.risk_flags ? (
            <p className="mt-3 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-xs leading-relaxed text-warning">
              {stock.risk_flags}
            </p>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">No major local risk flags fired for this symbol.</p>
          )}
        </Section>

        <Section icon={Droplets} title="Delivery and large-deal flow" subtitle="Free exchange evidence for participation and unusual activity. Direction still needs human interpretation.">
          <div className="grid gap-2 sm:grid-cols-4">
            <MiniStat label="Delivery score" value={stock.delivery_accumulation_score?.toFixed(0) ?? '—'} />
            <MiniStat label="Latest delivery" value={stock.delivery_pct_latest != null ? `${stock.delivery_pct_latest.toFixed(1)}%` : '—'} />
            <MiniStat label="20d median" value={stock.delivery_pct_median_20d != null ? `${stock.delivery_pct_median_20d.toFixed(1)}%` : '—'} />
            <MiniStat label="High-delivery days" value={formatValue(stock.high_delivery_days_20d, 'integer')} />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <MiniStat label="Deal activity" value={stock.deal_activity_score?.toFixed(0) ?? '—'} />
            <MiniStat label="Bulk / block / short" value={`${stock.bulk_deal_count?.toFixed(0) ?? 0}/${stock.block_deal_count?.toFixed(0) ?? 0}/${stock.short_deal_count?.toFixed(0) ?? 0}`} />
            <MiniStat label="Deal value" value={formatTurnover(stock.deal_value)} />
            <MiniStat label="Net deal qty" value={formatValue(stock.deal_net_qty, 'integer')} />
          </div>
          {(stock.deal_count ?? 0) > 0 ? (
            <Card className="mt-3" size="sm">
              <CardContent>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Latest large-deal row</div>
              <p className="mt-1 text-sm text-foreground">
                {stock.deal_latest_type || 'deal'} {stock.deal_latest_side ? `· ${stock.deal_latest_side}` : ''} · {stock.deal_latest_client || 'client not disclosed'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{stock.deal_latest_date ?? ''}</p>
              </CardContent>
            </Card>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">No NSE bulk/block/short-deal row in the current snapshot.</p>
          )}
        </Section>

        <Section
          icon={Users}
          title="Large shareholders"
          subtitle="SEBI SAST filings: anyone crossing 5% of a company must disclose it, and so must promoters."
        >
          {(stock.sast_events_180d ?? 0) > 0 ? (
            <>
              <div className="grid gap-2 sm:grid-cols-4">
                <MiniStat label="Filings (180d)" value={String(stock.sast_events_180d ?? 0)} />
                <MiniStat label="Acquisitions" value={String(stock.sast_acquisitions ?? 0)} />
                <MiniStat label="Disposals" value={String(stock.sast_disposals ?? 0)} />
                <MiniStat
                  label="Net shares"
                  value={formatValue(stock.sast_net_shares, 'integer')}
                  hint={(stock.sast_net_shares ?? 0) >= 0 ? 'net accumulation' : 'net reduction'}
                />
              </div>
              {(stock.sast_promoter_buying || stock.sast_promoter_selling) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {stock.sast_promoter_buying && (
                    <Badge variant="outline" className="border-success/30 bg-success-subtle text-success">
                      promoter buying
                    </Badge>
                  )}
                  {stock.sast_promoter_selling && (
                    <Badge variant="outline" className="border-warning/30 bg-warning-subtle text-warning">
                      promoter selling
                    </Badge>
                  )}
                </div>
              )}
              {stock.sast_latest_holder && (
                <Card className="mt-3" size="sm">
                  <CardContent>
                    <div className="t-label">Most recent filing</div>
                    <p className="mt-1 text-sm text-foreground">
                      {stock.sast_latest_holder} {stock.sast_latest_action}
                      {stock.sast_latest_stake != null && ` — now holds ${stock.sast_latest_stake.toFixed(2)}%`}
                    </p>
                    <p className="mt-1 t-meta text-muted-foreground">{stock.sast_latest_date ?? ''}</p>
                  </CardContent>
                </Card>
              )}
              <p className="mt-3 t-meta text-muted-foreground">
                A disclosure says a stake changed, not why. Funds rebalance, estates get divided and
                promoters pledge. Evidence to weigh, not a signal to follow.
              </p>
            </>
          ) : (
            <p className="t-body text-muted-foreground">
              No SAST filing for this stock in the last 180 days. Most companies have none in a given
              window — it only triggers above 5%, or on promoter activity.
            </p>
          )}
        </Section>

        <Section icon={CalendarDays} title="Official events / news" subtitle="NSE + BSE corporate announcements from the current event window.">
          <div className="grid gap-2 sm:grid-cols-4">
            <MiniStat label="Event score" value={stock.news_event_score?.toFixed(0) ?? '—'} />
            <MiniStat label="Events" value={formatValue(stock.news_count_14d, 'integer')} />
            <MiniStat label="Constructive" value={formatValue(stock.news_positive_14d, 'integer')} />
            <MiniStat label="Risk flags" value={formatValue(stock.news_negative_14d, 'integer')} />
          </div>
          {stock.news_last_title ? (
            <Card className="mt-3" size="sm">
              <CardContent>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Latest announcement</div>
              <p className="mt-1 text-sm text-foreground">{stock.news_last_title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{stock.news_last_date ?? ''}</p>
              {stock.news_last_url && (
                <a
                  href={stock.news_last_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline"
                >
                  Open exchange attachment
                </a>
              )}
              </CardContent>
            </Card>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              No official NSE/BSE announcement was found for this stock in the current event window.
            </p>
          )}
        </Section>

        </>)}

        {pane === 'fundamentals' && (<>
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
            <MiniStat label="Sector" value={stock.sector ?? 'Unknown'} />
            <MiniStat label="Peer bucket" value={bucketLabel} />
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

        </>)}

        {pane === 'technicals' && (<>
        <Section icon={Activity} title="Returns and technicals" subtitle={`Measured through ${screen.last_trading_session}.`}>
          <MetricGrid items={growth.slice(2)} />
          <div className="mt-2">
            <MetricGrid items={technicals} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
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
            <p className={`mt-3 text-xs leading-relaxed ${positionShare > 0.01 ? 'text-warning' : 'text-muted-foreground'}`}>
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
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="pillar" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                  <Radar dataKey="value" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.18} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        )}

        </>)}

        {pane === 'audit' && (<>
        <Section icon={Layers} title="Raw inputs by pillar" subtitle="The numbers below are the inputs used to build the score.">
          <div className="space-y-4">
            {PILLARS.map((p: Pillar) => (
              <div key={p}>
                <div className="mb-2 flex items-baseline justify-between">
                  <div className="text-sm font-medium capitalize text-foreground">{p}</div>
                  <span className={`text-sm font-semibold tabular-nums ${scoreColor(stock[p])}`}>
                    {stock[p]?.toFixed(0) ?? 'n/a'}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {(screen.metrics[p] ?? []).map((m) => (
                    <div key={m} className="flex justify-between border-b py-1">
                      <dt className="text-xs text-muted-foreground">{METRIC_LABELS[m] ?? m}</dt>
                      <dd className="text-xs tabular-nums text-foreground">
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
          <p className="text-xs leading-relaxed text-muted-foreground">
            This panel now shows every fundamental, technical, liquidity and data-quality field currently available in
            market-lab's public-data cache. It still does not include quarterly P&L tables, balance sheet line items,
            cash-flow statements, shareholding patterns, concalls or annual reports. Those need separate, source-specific
            ingestion before they can be shown honestly.
          </p>
        </Section>

        </>)}

        <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
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
