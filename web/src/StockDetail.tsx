import { Radar, RadarChart, PolarAngleAxis, PolarGrid, ResponsiveContainer } from 'recharts';
import { Activity, Info, TriangleAlert, X } from 'lucide-react';
import {
  formatCrore,
  formatMetric,
  METRIC_LABELS,
  PILLARS,
  PILLAR_HELP,
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

export function StockDetail({
  stock,
  screen,
  onClose,
}: {
  stock: Stock;
  screen: Screen;
  onClose: () => void;
}) {
  const radar = PILLARS.filter((p) => stock[p] !== null).map((p) => ({
    pillar: p.charAt(0).toUpperCase() + p.slice(1),
    value: stock[p] ?? 0,
  }));

  const flags = (stock.data_flags ?? '').split(',').filter(Boolean);

  return (
    <aside className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/40">
      <header className="flex items-start justify-between border-b border-slate-800 p-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{stock.ticker}</h2>
          <p className="text-sm text-slate-400">{stock.name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {stock.sector ?? 'Unknown sector'} · {formatCrore(stock.market_cap)}
            {stock.price ? ` · ₹${stock.price.toFixed(1)}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300">
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <div className="mb-4 flex items-baseline gap-3">
          <span className={`text-4xl font-bold tabular-nums ${scoreColor(stock.composite)}`}>
            {stock.composite?.toFixed(0) ?? '—'}
          </span>
          <div>
            <div className="text-sm text-slate-300">{stock.band}</div>
            <div className="text-xs text-slate-500">
              percentile vs {screen.n_scored} peers · {((stock.coverage ?? 0) * 100).toFixed(0)}% data coverage
            </div>
          </div>
        </div>

        {flags.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
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

        {radar.length >= 3 && (
          <div className="mb-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radar} outerRadius="72%">
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="pillar" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Radar dataKey="value" stroke="#2dd4bf" fill="#2dd4bf" fillOpacity={0.25} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="space-y-4">
          {PILLARS.map((p: Pillar) => (
            <section key={p}>
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="text-sm font-medium capitalize text-slate-200">{p}</h3>
                <span className={`text-sm font-semibold tabular-nums ${scoreColor(stock[p])}`}>
                  {stock[p]?.toFixed(0) ?? 'n/a'}
                  <span className="ml-1 text-xs font-normal text-slate-600">
                    ×{((screen.weights[p] ?? 0) * 100).toFixed(0)}%
                  </span>
                </span>
              </div>
              <p className="mb-2 text-xs leading-relaxed text-slate-500">{PILLAR_HELP[p]}</p>
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
            </section>
          ))}
        </div>

        <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-300">
            <Activity className="size-4 text-slate-500" /> Price context
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ['6m return', stock.ret_6m === null ? '—' : `${(stock.ret_6m * 100).toFixed(1)}%`],
              ['12m return', stock.ret_12m === null ? '—' : `${(stock.ret_12m * 100).toFixed(1)}%`],
              ['Volatility', stock.ann_vol === null ? '—' : `${(stock.ann_vol * 100).toFixed(0)}%`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="text-sm tabular-nums text-slate-200">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="mt-4 flex gap-2 text-xs leading-relaxed text-slate-500">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            These are measured characteristics as of {screen.as_of}, ranked against peers on that
            date. They describe what this company looks like now — not what the share price will do
            next. High scores have no predictive guarantee.
          </span>
        </p>
      </div>
    </aside>
  );
}
