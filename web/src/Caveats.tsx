import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Screen } from './types';

type ControlStatus = 'solved' | 'mitigated' | 'residual';

type Control = {
  title: string;
  status: ControlStatus;
  body: string;
};

function statusBadge(status: ControlStatus) {
  if (status === 'solved') return <Badge className="bg-success-subtle text-white hover:bg-success-subtle">Solved</Badge>;
  if (status === 'mitigated') return <Badge variant="secondary">Mitigated</Badge>;
  return <Badge variant="outline">Residual risk</Badge>;
}

function controls(screen: Screen): Control[] {
  const excluded = screen.excluded.length.toLocaleString('en-IN');
  const universe = screen.universe_total.toLocaleString('en-IN');
  const scored = screen.scored.toLocaleString('en-IN');
  const highRisk = (screen.high_risk_symbols ?? 0).toLocaleString('en-IN');
  const foBan = (screen.fo_ban_count ?? 0).toLocaleString('en-IN');

  return [
  {
    title: 'Prediction risk',
    status: 'residual',
    body: 'No product can solve uncertainty or guarantee future prices. market-lab now treats scores as measured research fit only, labels horizons explicitly, and keeps the full audit trail beside every stock instead of presenting buy/sell calls.',
  },
  {
    title: 'Survivorship bias',
    status: 'mitigated',
    body: `The live board no longer uses backtested performance claims to rank stocks. It starts from the current official NSE EQ universe (${universe}), scores ${scored} names, and shows ${excluded} exclusions with reasons. A true historical backtest would still need point-in-time constituents and delisted-company data before being trusted.`,
  },
  {
    title: 'Single-factor traps',
    status: 'mitigated',
    body: 'The ranking is no longer a pure reversal or pure momentum screen. Opportunity score combines horizon fit, fundamentals, trend, liquidity, official events, delivery/deal flow, and risk penalties so one seductive factor cannot dominate unnoticed.',
  },
  {
    title: 'Entry-date sensitivity',
    status: 'mitigated',
    body: 'The UI exposes separate 1-3m, 6-12m, and 3-5y fits plus volatility, drawdown/risk flags, liquidity, and market breadth. That does not make timing safe, but it stops the board from pretending one entry date or one horizon is universally right.',
  },
  {
    title: 'Derivative blow-up risk',
    status: 'solved',
    body: `Derivatives are not part of this product. There is no order placement, no options/futures strategy layer, and no leverage workflow. The only F&O-related signal is defensive: ${foBan} symbols are currently in F&O ban and ${highRisk} names are marked high-risk.`,
  },
  {
    title: 'Bad or incomplete data',
    status: 'mitigated',
    body: `Prices, liquidity, delivery, deals, F&O ban, and official events now come from NSE/BSE/public exchange sources with source-health checks. Fundamentals can still be incomplete, so the board separates fundamental+technical names from technical-only names, shows coverage, suppresses implausible values, and discloses every excluded stock.`,
  },
  {
    title: 'Regulatory boundary',
    status: 'residual',
    body: 'This still cannot become personalised investment advice without SEBI RIA/RA registration. The solved version is product behavior: auditable research, no personal allocation, no trade execution, no guaranteed performance language.',
  },
  ];
}

export function Caveats({ screen }: { screen: Screen }) {
  // Closed by default. This material is essential before acting on a score, but seven
  // expanded paragraphs above the board made the tool look like a legal disclaimer
  // instead of a research product. It stays one click away and remembers your choice.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('ml-caveats-collapsed') === '0';
    } catch {
      return false;
    }
  });
  const items = controls(screen);
  const solved = items.filter((p) => p.status === 'solved').length;
  const mitigated = items.filter((p) => p.status === 'mitigated').length;

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem('ml-caveats-collapsed', next ? '0' : '1');
    } catch {
      // Disclosure state remains usable for this visit.
    }
  }

  return (
    <Card className="overflow-hidden border-primary/20 bg-primary/5">
      <Button
        onClick={toggle}
        variant="ghost"
        className="h-auto w-full justify-start rounded-none px-5 py-4 text-left hover:bg-primary/10"
      >
        <ShieldAlert className="size-5 shrink-0 text-primary" />
        <div className="flex-1">
          <h2 className="font-semibold text-foreground">Risk controls before using any score</h2>
          <p className="text-sm text-muted-foreground">
            {open
              ? `${solved} solved, ${mitigated} mitigated, and ${items.length - solved - mitigated} still inherently unsolved.`
              : 'Risk controls hidden — click to see what has been solved, mitigated, or remains unavoidable.'}
          </p>
        </div>
        {open ? (
          <ChevronUp className="size-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-5 text-muted-foreground" />
        )}
      </Button>

      {open && (
        <div className="grid gap-4 border-t px-5 py-4 md:grid-cols-2">
          {items.map((p) => (
            <div key={p.title} className="flex gap-3">
              {p.status === 'residual' ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{p.title}</h3>
                  {statusBadge(p.status)}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground md:col-span-2">
            Bottom line: the scary caveats are no longer just warnings. The tool now blocks or mitigates
            the ones that can be controlled, and explicitly labels the remaining limits instead of pretending
            they are solved.
          </p>
        </div>
      )}
    </Card>
  );
}
