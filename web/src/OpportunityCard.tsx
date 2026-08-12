import { ArrowRight, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { OwnershipBadge } from './OwnershipBadge';
import {
  BUCKET_LABEL,
  HORIZONS,
  HORIZON_LABEL,
  PILLARS,
  formatCrore,
  formatTurnover,
  type Pillar,
  type Stock,
} from './types';

/**
 * A single research case, not a recommendation.
 *
 * The previous version said "Strong on growth, momentum" and printed a score, which does
 * not let anyone decide anything: it never said for how long, how risky, how tradeable,
 * or what argues against it. A number with no counter-argument is the exact shape of a
 * tip, and this tool is deliberately not that. So every card now carries:
 *   - the horizon the score actually applies to
 *   - the specific evidence, with real values
 *   - the risk lens and any exchange restriction
 *   - what a real position does to the order book (the constraint retail ignores most)
 *   - the weakest pillar, stated as plainly as the strengths
 */

const PILLAR_EVIDENCE: Record<Pillar, (s: Stock) => string | null> = {
  quality: (s) => (s.roe != null ? `ROE ${(s.roe * 100).toFixed(0)}%` : null),
  growth: (s) => (s.revenue_cagr != null ? `revenue CAGR ${(s.revenue_cagr * 100).toFixed(0)}%` : null),
  valuation: (s) => (s.pe != null ? `PE ${s.pe.toFixed(1)}` : s.pb != null ? `PB ${s.pb.toFixed(1)}` : null),
  trend: (s) => (s.above_200dma != null ? `${s.above_200dma >= 0 ? '+' : ''}${s.above_200dma.toFixed(0)}% vs 200DMA` : null),
  momentum: (s) => (s.ret_12m != null ? `12m return ${(s.ret_12m * 100).toFixed(0)}%` : null),
};

function strengths(stock: Stock) {
  return PILLARS.filter((p) => (stock[p] ?? 0) >= 65)
    .sort((a, b) => (stock[b] ?? 0) - (stock[a] ?? 0))
    .slice(0, 3)
    .map((p) => {
      const ev = PILLAR_EVIDENCE[p](stock);
      return { pillar: p, score: stock[p] as number, evidence: ev };
    });
}

/** The weakest scored pillar — the argument against, shown as prominently as the case for. */
function weakest(stock: Stock) {
  const scored = PILLARS.filter((p) => stock[p] != null);
  if (!scored.length) return null;
  const p = scored.reduce((lo, cur) => ((stock[cur] as number) < (stock[lo] as number) ? cur : lo));
  return { pillar: p, score: stock[p] as number, evidence: PILLAR_EVIDENCE[p](stock) };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-[13px] font-semibold text-foreground">{value}</div>
      {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function OpportunityCard({
  stock,
  rank,
  onSelect,
}: {
  stock: Stock;
  rank: number;
  onSelect: (symbol: string) => void;
}) {
  const best = HORIZONS.find((h) => h.key === stock.best_horizon) ?? HORIZONS[1];
  const fit = stock[best.scoreKey];
  const pros = strengths(stock);
  const con = weakest(stock);

  // What a real order does to the book. Not advice — an arithmetic constraint that
  // decides whether any of the above is actionable at all.
  const share = stock.turnover_median && stock.turnover_median > 0 ? 1e5 / stock.turnover_median : null;
  const heavy = share != null && share > 0.01;

  const riskTone =
    stock.risk_level === 'High'
      ? 'border-danger/30 bg-danger-subtle text-danger'
      : stock.risk_level === 'Watch'
        ? 'border-warning/30 bg-warning-subtle text-warning'
        : 'border-success/30 bg-success-subtle text-success';

  return (
    <button
      type="button"
      onClick={() => onSelect(stock.symbol)}
      className="block w-full px-4 py-4 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
          {rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{stock.symbol}</span>
            {stock.bucket && <Badge variant="secondary">{BUCKET_LABEL[stock.bucket]}</Badge>}
            <Badge variant="outline" className={riskTone}>
              <ShieldAlert className="size-3" />
              {stock.risk_level ?? 'unrated'} risk
            </Badge>
            {stock.fno_ban && (
              <Badge variant="outline" className="border-danger/30 bg-danger-subtle text-danger">
                F&amp;O ban
              </Badge>
            )}
            <OwnershipBadge stock={stock} />
            {stock.rating_basis === 'technical only' && (
              <Badge variant="outline" className="border-warning/30 bg-warning-subtle text-warning">
                technical only
              </Badge>
            )}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{stock.name}</div>

          {/* The case for, with the numbers behind it. */}
          {pros.length > 0 && (
            <p className="mt-2 text-[13px] leading-relaxed text-foreground">
              Ranks well on{' '}
              {pros.map((p, i) => (
                <span key={p.pillar}>
                  {i > 0 && (i === pros.length - 1 ? ' and ' : ', ')}
                  <span className="font-medium">{p.pillar}</span>
                  {p.evidence && <span className="text-muted-foreground"> ({p.evidence})</span>}
                </span>
              ))}
              .
            </p>
          )}

          {/* The case against, never hidden. */}
          {con && (
            <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>
                Weakest on <span className="font-medium text-foreground">{con.pillar}</span> ({con.score.toFixed(0)}/100
                {con.evidence ? `, ${con.evidence}` : ''}).
                {stock.risk_flags ? ` Flags: ${stock.risk_flags}.` : ''}
              </span>
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Scores highest for"
              value={stock.best_horizon ? HORIZON_LABEL[stock.best_horizon] : '—'}
              hint={fit != null ? `fit ${fit.toFixed(0)}/100` : undefined}
            />
            <Stat
              label="Size"
              value={formatCrore(stock.market_cap)}
              hint={stock.sector ?? undefined}
            />
            <Stat
              label="Avg daily turnover"
              value={formatTurnover(stock.turnover_median)}
              hint={stock.delivery_pct_latest != null ? `${stock.delivery_pct_latest.toFixed(0)}% delivery` : undefined}
            />
            <Stat
              label="₹1L order impact"
              value={share != null ? `${(share * 100).toFixed(2)}% of a day` : '—'}
              hint={heavy ? 'you would move the price' : 'absorbed easily'}
            />
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold tabular-nums tracking-[-0.03em] text-foreground">
            {stock.opportunity_score?.toFixed(0) ?? '—'}
          </div>
          <div className="text-[10px] text-muted-foreground">research score</div>
          <ArrowRight className="mt-2 ml-auto size-4 text-muted-foreground" />
        </div>
      </div>
    </button>
  );
}
