import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  Database,
  Download,
  EyeOff,
  Filter,
  Layers,
  Loader2,
  MoreVertical,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ApiHealth } from './ApiHealth';
import { Caveats } from './Caveats';
import { Disclosure } from './Disclosure';
import LiveStatus from './LiveStatus';
import { StockDetail } from './StockDetail';
import { StockTable } from './StockTable';
import { OpportunityCard } from './OpportunityCard';
import { Chat } from './Chat';
import { PortfolioBody } from './Portfolio';
import { Investors } from './Investors';
import { DesktopNav, MobileNav, type TabKey } from './Nav';
import { ThemeToggle } from './ThemeToggle';
import { SegmentedControl } from './SegmentedControl';
import type { HorizonKey, RatingBasis, Screen, SizeBucket, Stock } from './types';
import { BUCKET_HELP, BUCKET_LABEL, BUCKETS, HORIZONS } from './types';
import { exportToCsv } from '@/lib/export';
import { loadScreen } from '@/lib/dataSource';
import { useKeyboardNav } from '@/lib/useKeyboardNav';

type ExperienceMode = 'guided' | 'pro';
type RiskFilter = 'all' | 'low' | 'avoid-high' | 'no-fno';
type FlowFilter = 'all' | 'large-deals' | 'delivery' | 'both' | 'sast' | 'promoter-buying';

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  drill,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  detail?: string;
  /** Optional drill-down: turns a read-only number into a filter you can act on. */
  drill?: { label: string; onSelect: () => void };
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="truncate text-[17px] font-semibold tracking-[-0.01em] text-foreground">{value}</div>
        </div>
      </div>
      {detail && <p className="text-[13px] leading-relaxed text-muted-foreground">{detail}</p>}
      {drill && (
        <Button variant="outline" size="sm" onClick={drill.onSelect} className="w-full">
          {drill.label}
        </Button>
      )}
      </CardContent>
    </Card>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: Array<{ value: string | number; label: string }>;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <Select value={String(value)} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={String(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Set<SizeBucket>>(new Set(BUCKETS));
  const [basis, setBasis] = useState<'all' | RatingBasis>('all');
  const [horizon, setHorizon] = useState<HorizonKey>('medium');
  const [mode, setMode] = useState<ExperienceMode>('guided');
  const [minFit, setMinFit] = useState(0);
  const [fundamentalFilter, setFundamentalFilter] = useState('all');
  const [technicalFilter, setTechnicalFilter] = useState('all');
  const [newsFilter, setNewsFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('avoid-high');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all');
  const [liquidityFloor, setLiquidityFloor] = useState(0);
  const [customFormula, setCustomFormula] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('discover');
  const compactLayout = useMediaQuery('(max-width: 1279px)');
  const horizonMeta = HORIZONS.find((h) => h.key === horizon) ?? HORIZONS[1];

  const load = useCallback(async () => {
    try {
      setScreen(await loadScreen());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleBucket = (bucket: SizeBucket) => {
    setBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next.size ? next : new Set(BUCKETS);
    });
  };

  const visible = useMemo(() => {
    if (!screen) return [];
    
    // Evaluate custom formula if provided
    let customEval: ((s: Stock) => boolean) | null = null;
    if (customFormula.trim()) {
      try {
        // Create a safe evaluator function
        // Replaces variable names with s.variableName
        let expression = customFormula.trim().toLowerCase();
        // Extract all word characters that aren't operators or numbers
        const vars = Array.from(new Set(expression.match(/[a-z_][a-z0-9_]*/g) || []));
        const safeVars = ['and', 'or', 'true', 'false', 'null'];
        
        let jsExpr = expression.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||');
        vars.forEach(v => {
          if (!safeVars.includes(v)) {
            const regex = new RegExp(`\\b${v}\\b`, 'g');
            jsExpr = jsExpr.replace(regex, `(s.${v} ?? 0)`);
          }
        });
        
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        customEval = new Function('s', `try { return !!(${jsExpr}); } catch(e) { return false; }`) as (s: Stock) => boolean;
      } catch (e) {
        // Ignore invalid formulas until they are valid
        customEval = null;
      }
    }

    return screen.stocks.filter((stock) => {
      if (customEval && !customEval(stock)) return false;
      if (stock.bucket && !buckets.has(stock.bucket)) return false;
      if (basis !== 'all' && stock.rating_basis !== basis) return false;
      const fit = stock[horizonMeta.scoreKey] ?? 0;
      if (fit < minFit) return false;
      if (liquidityFloor > 0 && (stock.turnover_median ?? 0) < liquidityFloor) return false;
      if (fundamentalFilter === 'quality-growth' && ((stock.quality ?? 0) < 60 || (stock.growth ?? 0) < 60)) return false;
      if (fundamentalFilter === 'quality-value' && ((stock.quality ?? 0) < 60 || (stock.valuation ?? 0) < 60)) return false;
      if (fundamentalFilter === 'clean-balance-sheet' && ((stock.quality ?? 0) < 60 || (stock.debt_to_equity ?? 99) > 1.5)) return false;
      if (technicalFilter === 'uptrend' && ((stock.trend ?? 0) < 60 || (stock.momentum ?? 0) < 50)) return false;
      if (technicalFilter === 'momentum' && (stock.momentum ?? 0) < 70) return false;
      if (newsFilter === 'recent' && (stock.news_count_14d ?? 0) === 0) return false;
      if (newsFilter === 'constructive' && (stock.news_event_score ?? 0) < 60) return false;
      if (newsFilter === 'no-risk' && (stock.news_negative_14d ?? 0) > 0) return false;
      if (riskFilter === 'low' && stock.risk_level !== 'Low') return false;
      if (riskFilter === 'avoid-high' && stock.risk_level === 'High') return false;
      if (riskFilter === 'no-fno' && stock.fno_ban) return false;
      if (flowFilter === 'large-deals' && (stock.deal_count ?? 0) === 0) return false;
      if (flowFilter === 'delivery' && (stock.delivery_accumulation_score ?? 0) < 65) return false;
      if (flowFilter === 'both' && ((stock.deal_count ?? 0) === 0 || (stock.delivery_accumulation_score ?? 0) < 65)) return false;
      if (flowFilter === 'sast' && (stock.sast_events_180d ?? 0) === 0) return false;
      if (flowFilter === 'promoter-buying' && !stock.sast_promoter_buying) return false;
      return true;
    });
  }, [
    screen,
    buckets,
    basis,
    horizonMeta.scoreKey,
    minFit,
    liquidityFloor,
    fundamentalFilter,
    technicalFilter,
    newsFilter,
    riskFilter,
    flowFilter,
  ]);

  // Keyboard navigation over whatever is currently on screen.
  useKeyboardNav({
    symbols: useMemo(() => visible.map((s) => s.symbol), [visible]),
    selected,
    onSelect: setSelected,
    onClose: () => setSelected(null),
  });

  const opportunities = useMemo(
    () =>
      [...visible]
        .sort((a, b) => (b.opportunity_score ?? -Infinity) - (a.opportunity_score ?? -Infinity))
        .slice(0, mode === 'guided' ? 6 : 3),
    [visible, mode],
  );

  if (error && !screen) {
    return (
      <div className="grid min-h-screen place-items-center p-8 text-center">
        <div>
          <p className="text-danger">Could not load the screen — {error}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Run <code className="rounded-md bg-white px-1.5 py-0.5">./run.sh</code> from the project root, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (!screen) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stock = screen.stocks.find((s) => s.symbol === selected) ?? null;
  const strongMatches = visible.filter((s) => (s.opportunity_score ?? 0) >= 80 && s.risk_level !== 'High').length;  const filterPanels = (
    <>
      <section>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="size-4 text-muted-foreground" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Horizon</div>
            <SegmentedControl
              label="Time horizon"
              value={horizon}
              onChange={setHorizon}
              items={HORIZONS.map((h) => ({ value: h.key, label: h.label }))}
            />
          </div>

          <SelectControl
            label="Minimum fit"
            value={minFit}
            onChange={(v) => setMinFit(Number(v))}
            options={[
              { value: 0, label: 'Any score' },
              { value: 60, label: '60+' },
              { value: 75, label: '75+' },
              { value: 90, label: '90+' },
            ]}
          />
          <Disclosure
            title="More filters"
            summary="Fundamentals, technicals, events, risk, flows, liquidity and custom formulas."
          >
            <div className="space-y-4">
          <SelectControl
            label="Fundamentals"
            value={fundamentalFilter}
            onChange={setFundamentalFilter}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'quality-growth', label: 'Quality + growth 60+' },
              { value: 'quality-value', label: 'Quality + value 60+' },
              { value: 'clean-balance-sheet', label: 'Quality 60+ and D/E <= 1.5' },
            ]}
          />
          <SelectControl
            label="Technicals"
            value={technicalFilter}
            onChange={setTechnicalFilter}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'uptrend', label: 'Trend 60+ and momentum 50+' },
              { value: 'momentum', label: 'Momentum 70+' },
            ]}
          />
          <SelectControl
            label="Official events"
            value={newsFilter}
            onChange={setNewsFilter}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'recent', label: 'Has event in 14d' },
              { value: 'constructive', label: 'Event score 60+' },
              { value: 'no-risk', label: 'No risk event in 14d' },
            ]}
          />
          <SelectControl
            label="Risk"
            value={riskFilter}
            onChange={(v) => setRiskFilter(v as RiskFilter)}
            options={[
              { value: 'all', label: 'Any risk' },
              { value: 'avoid-high', label: 'Avoid high-risk' },
              { value: 'low', label: 'Low risk only' },
              { value: 'no-fno', label: 'No F&O ban' },
            ]}
          />
          <SelectControl
            label="Flows"
            value={flowFilter}
            onChange={(v) => setFlowFilter(v as FlowFilter)}
            options={[
              { value: 'all', label: 'Any flow' },
              { value: 'large-deals', label: 'Has bulk/block deal' },
              { value: 'delivery', label: 'Delivery strength' },
              { value: 'both', label: 'Deals + delivery' },
              { value: 'sast', label: 'Large-holder filing (180d)' },
              { value: 'promoter-buying', label: 'Promoter buying' },
            ]}
          />
          <SelectControl
            label="Liquidity"
            value={liquidityFloor}
            onChange={(v) => setLiquidityFloor(Number(v))}
            options={[
              { value: 0, label: 'Any tradeable' },
              { value: 10000000, label: 'Rs 1 cr/day+' },
              { value: 100000000, label: 'Rs 10 cr/day+' },
              { value: 1000000000, label: 'Rs 100 cr/day+' },
            ]}
          />
              <div>
                <label className="mb-2 block t-label" htmlFor="ml-formula">Custom formula</label>
                <Input
                  id="ml-formula"
                  value={customFormula}
                  onChange={(e) => setCustomFormula(e.target.value)}
                  placeholder="pe < 15 and roe > 0.15"
                  className="h-9 font-mono text-xs"
                />
                <p className="mt-1.5 t-meta text-muted-foreground">
                  Any expression over stock fields. The assistant writes these for you too.
                </p>
              </div>
            </div>
          </Disclosure>
        </CardContent>
      </Card>
      </section>

      <section>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Universe</CardTitle>
          <CardDescription>{visible.length.toLocaleString('en-IN')} shown</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {BUCKETS.map((bucket) => {
            const n = screen.stocks.filter((s) => s.bucket === bucket).length;
            const on = buckets.has(bucket);
            return (
              <Button
                key={bucket}
                type="button"
                onClick={() => toggleBucket(bucket)}
                title={BUCKET_HELP[bucket]}
                variant={on ? 'default' : 'outline'}
                size="sm"
              >
                {BUCKET_LABEL[bucket]} {n}
              </Button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['all', 'fundamental + technical', 'technical only'] as const).map((item) => (
            <Button
              key={item}
              type="button"
              onClick={() => setBasis(item)}
              variant={basis === item ? 'default' : 'outline'}
              size="sm"
            >
              {item === 'all' ? 'Any basis' : item}
            </Button>
          ))}
        </div>
        </CardContent>
      </Card>
      </section>
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-[1680px] items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-foreground sm:text-[22px] sm:tracking-[-0.03em]">
              market-lab
            </h1>
            <p className="hidden text-[13px] text-muted-foreground lg:block">
              Every NSE stock, scored from official exchange data. Research, not advice.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DesktopNav tab={tab} onChange={setTab} />
          </div>
          <ThemeToggle />
          <Button
            variant="outline"
            size="icon"
            className="size-10 shrink-0 sm:size-8"
            onClick={() => setChatOpen(true)}
            title="AI assistant"
          >
            <Sparkles className="size-4" />
            <span className="sr-only">AI assistant</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-10 shrink-0 sm:size-8">
                <MoreVertical className="size-4" />
                <span className="sr-only">More options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportToCsv(screen, visible)}>
                <Download className="mr-2 size-4" />
                Export {visible.length.toLocaleString('en-IN')} filtered stocks
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportToCsv(screen)}>
                <Download className="mr-2 size-4" />
                Export full universe ({screen.stocks.length.toLocaleString('en-IN')})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 py-4 pb-24 sm:px-8 sm:py-5 md:pb-8">
        <div className="mb-5">
          <LiveStatus onDataChanged={load} screen={screen} />
        </div>

        <div className={tab === 'screen' ? 'grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]' : ''}>
          {tab === 'screen' && (
            <nav className="hidden space-y-4 lg:sticky lg:top-[136px] lg:block lg:self-start" aria-label="Research filters">
              {filterPanels}
            </nav>
          )}

          <div className="min-w-0 space-y-5">

            {tab === 'discover' && (
            <Disclosure
              title={`Market today: ${screen.market_regime ?? 'unknown'}`}
              summary={`${screen.breadth_advance_pct?.toFixed(0) ?? '—'}% of stocks advancing · ${screen.scored.toLocaleString('en-IN')} of ${screen.universe_total.toLocaleString('en-IN')} scored · session ${screen.last_trading_session}`}
              icon={<Activity className="size-4" />}
            >
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {screen.market_regime_summary ?? 'Breadth layer unavailable.'}
              </p>
              <section className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <MetricTile
                  icon={Layers}
                  label="Universe"
                  value={`${screen.scored.toLocaleString('en-IN')} / ${screen.universe_total.toLocaleString('en-IN')}`}
                  detail="Normal NSE EQ-series stocks."
                />
                <MetricTile icon={CalendarDays} label="Last session" value={screen.last_trading_session} detail="Official NSE EOD bhavcopy." />
                <MetricTile
                  icon={Users}
                  label="Breadth"
                  value={`${screen.breadth_advance_pct?.toFixed(0) ?? '—'}% advancing`}
                  detail={`${screen.above_50dma_pct?.toFixed(0) ?? '—'}% above 50 DMA · ${screen.breadth_advancers?.toLocaleString('en-IN') ?? '—'} up vs ${screen.breadth_decliners?.toLocaleString('en-IN') ?? '—'} down.`}
                />
                <MetricTile
                  icon={Sparkles}
                  label="Flows"
                  value={`${screen.deal_symbols ?? 0} symbols`}
                  detail={`${screen.delivery_symbols ?? 0} with delivery data.`}
                  drill={{ label: 'Show only stocks with large deals', onSelect: () => setFlowFilter('large-deals') }}
                />
                <MetricTile
                  icon={Users}
                  label="Institutional flow"
                  value={
                    screen.fii_net_cr != null
                      ? `FII ${screen.fii_net_cr >= 0 ? '+' : ''}${(screen.fii_net_cr / 1000).toFixed(1)}k cr`
                      : '—'
                  }
                  detail={
                    screen.dii_net_cr != null
                      ? `DII ${screen.dii_net_cr >= 0 ? '+' : ''}${(screen.dii_net_cr / 1000).toFixed(1)}k cr net. Whole-market, not per stock.`
                      : 'NSE FII/DII activity.'
                  }
                />
                <MetricTile
                  icon={ShieldCheck}
                  label="Risk"
                  value={`${screen.high_risk_symbols ?? 0} high-risk`}
                  detail={`${screen.fo_ban_count ?? 0} in F&O ban · median 1m move ${screen.median_1m_return_pct?.toFixed(1) ?? '—'}%.`}
                  drill={{ label: 'Show only low-risk stocks', onSelect: () => setRiskFilter('low') }}
                />
              </section>
            </Disclosure>
            )}

            {tab === 'discover' && (
              <section>
                <Card className="overflow-hidden">
              <CardHeader className="border-b">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <TrendingUp className="size-4 text-primary" />
                      Highest ranked on this screen
                    </CardTitle>
                    <CardDescription>
                      Ranked by research score for the {horizonMeta.label} horizon — each with the
                      argument for, the argument against, and what a real position would do.
                      Not recommendations.
                    </CardDescription>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">{strongMatches.toLocaleString('en-IN')} score 80+ on low risk</div>
                </CardHeader>
                <div className="divide-y">
                  {opportunities.map((stockItem, i) => (
                    <OpportunityCard key={stockItem.symbol} stock={stockItem} rank={i + 1} onSelect={setSelected} />
                  ))}
                </div>
              </Card>
              </section>
            )}

            {tab === 'screen' && (
              <div className="flex items-center gap-2">
                <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="lg:hidden">
                      <Filter className="size-4" />
                      Filters
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-full overflow-auto sm:max-w-md lg:hidden">
                    <SheetHeader>
                      <SheetTitle>Filters</SheetTitle>
                    </SheetHeader>
                    <div className="space-y-4 px-4 pb-4">{filterPanels}</div>
                  </SheetContent>
                </Sheet>
                <div className="ml-auto">
                  <SegmentedControl
                    label="Table detail"
                    value={mode}
                    onChange={setMode}
                    size="sm"
                    className="w-auto"
                    items={[
                      { value: 'guided', label: 'Basic' },
                      { value: 'pro', label: 'Advanced' },
                    ]}
                  />
                </div>
              </div>
            )}

            {tab === 'screen' && (
            <div className={`grid gap-5 ${stock && !compactLayout ? 'xl:grid-cols-[minmax(0,1fr)_minmax(520px,640px)]' : ''}`}>
              <StockTable
                stocks={visible}
                selected={selected}
                onSelect={setSelected}
                rankingKey={horizonMeta.scoreKey}
                dense={mode === 'pro'}
              />
              {stock && !compactLayout && tab === 'screen' && (
                <StockDetail stock={stock} screen={screen} onClose={() => setSelected(null)} />
              )}
            </div>
            )}

            {tab === 'investors' && (
              <Investors
                screen={screen}
                onSelectStock={(sym) => {
                  setSelected(sym);
                  setTab('screen');
                }}
              />
            )}

            {tab === 'portfolio' && (
              <PortfolioBody screen={screen} onSelectStock={(sym) => { setSelected(sym); setTab('screen'); }} />
            )}

            {stock && (compactLayout || tab !== 'screen') && (
              <Sheet open onOpenChange={(open) => !open && setSelected(null)}>
                <SheetContent side="right" className="overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:w-[600px] data-[side=right]:lg:w-[760px] data-[side=right]:xl:w-[900px] data-[side=right]:sm:max-w-none" showCloseButton={false}>
                  <SheetTitle className="sr-only">{stock.symbol} factsheet</SheetTitle>
                  <StockDetail stock={stock} screen={screen} onClose={() => setSelected(null)} variant="sheet" />
                </SheetContent>
              </Sheet>
            )}

            {tab === 'trust' && (
            <section className="space-y-3 pt-2">
              <h2 className="text-sm font-semibold text-foreground">Methodology and data sources</h2>
              <p className="-mt-1 text-[13px] text-muted-foreground">
                How every score is calculated, where the data comes from, and what has been excluded.
              </p>

              <Caveats screen={screen} />

              <ApiHealth />

              <Disclosure
                title={`${screen.excluded.length.toLocaleString('en-IN')} stocks excluded from scoring`}
                summary="Which stocks were dropped before ranking, and the exact reason for each."
                icon={<EyeOff className="size-4" />}
              >
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background text-left text-muted-foreground">
                      <tr>
                        <th className="py-2 font-medium">Symbol</th>
                        <th className="py-2 font-medium">Size</th>
                        <th className="py-2 text-right font-medium">Sessions</th>
                        <th className="py-2 font-medium">Tradeable?</th>
                        <th className="py-2 font-medium">Reasons</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {screen.excluded.map((item) => (
                        <tr key={item.symbol}>
                          <td className="py-1.5 font-mono text-foreground">{item.symbol}</td>
                          <td className="py-1.5 text-muted-foreground">{item.bucket ?? '—'}</td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">{item.sessions ?? '—'}</td>
                          <td className="py-1.5">
                            {item.tradeable ? <span className="text-success">yes</span> : <span className="text-muted-foreground">no</span>}
                          </td>
                          <td className="py-1.5 text-muted-foreground">{item.reasons.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Disclosure>

              <Disclosure
                title="Corporate action adjustment"
                summary={`${screen.ca_symbols ?? 0} stocks back-adjusted for ${screen.ca_events ?? 0} splits and bonuses.`}
                icon={<Activity className="size-4" />}
              >
                <div className="space-y-3 t-body text-muted-foreground">
                  <p>
                    NSE&rsquo;s bhavcopy is a settlement record: it reports the price that actually
                    traded and never restates history. So when a company splits its stock or issues a
                    bonus, the close simply steps down overnight — HDFCBANK went ₹1,964 to ₹973 on its
                    ex-date — and any naive calculation reads that as a 50% crash.
                  </p>
                  <p>
                    Left alone this corrupts returns, momentum, trend, volatility, drawdown and
                    correlation. A 1:10 split shows as a −90% &ldquo;return&rdquo; and the stock gets ranked as a
                    falling knife when nothing happened to the business.
                  </p>
                  <p>
                    A split is separated from a real crash by the tape: price ÷ n with volume × n
                    leaves turnover almost unchanged, whereas a genuine collapse sends turnover
                    surging. Only moves that keep turnover intact are adjusted, so a real crash is
                    never smoothed away.
                  </p>
                  {screen.ca_examples && screen.ca_examples.length > 0 && (
                    <p className="text-foreground">Recent: {screen.ca_examples.join(', ')}.</p>
                  )}
                </div>
              </Disclosure>

              <Disclosure
                title="How the scores are built"
                summary="Pillar weights, the exact inputs behind each pillar, and how the horizon fits are combined."
                icon={<Layers className="size-4" />}
              >
                <div className="space-y-4 text-[13px] leading-relaxed text-muted-foreground">
                  <div>
                    <div className="mb-1 font-medium text-foreground">Composite pillar weights</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(screen.weights ?? {}).map(([k, v]) => (
                        <Badge key={k} variant="secondary">
                          {k} {(Number(v) * 100).toFixed(0)}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-foreground">Inputs used per pillar</div>
                    <ul className="space-y-1">
                      {Object.entries(screen.metrics ?? {}).map(([pillar, inputs]) => (
                        <li key={pillar}>
                          <span className="capitalize text-foreground">{pillar}</span> — {(inputs as string[]).join(', ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-foreground">Horizon weightings</div>
                    <ul className="space-y-1">
                      {Object.entries(screen.horizon_weights ?? {}).map(([key, cfg]) => (
                        <li key={key}>
                          <span className="text-foreground">{cfg.label}</span> —{' '}
                          {Object.entries(cfg.weights)
                            .map(([k, v]) => `${k} ${(Number(v) * 100).toFixed(0)}%`)
                            .join(', ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p>
                    Every score is a percentile rank against same-size peers on the same rating
                    basis, so a small-cap is never ranked against Reliance and a technical-only
                    score is never mixed with a fully-rated one.
                  </p>
                </div>
              </Disclosure>
            </section>
            )}

            <footer className="space-y-2 pb-5 text-xs leading-relaxed text-muted-foreground">
              <p>
                Generated {new Date(screen.generated_at).toLocaleString('en-IN')} · {screen.source} · {screen.sessions} sessions.
                Free layers include {screen.deal_source}, {screen.delivery_source}, {screen.news_source} and {screen.risk_source}.
              </p>
              {/* Its own line, not the tail of a sentence about build metadata. This is the
                  most important sentence on the page and it was the easiest one to skip. */}
              <p className="border-t pt-2 text-foreground">
                For research and education only. Nothing here is investment advice, a
                recommendation, or a solicitation to buy or sell any security. Scores rank
                companies against their peers on published, measurable criteria — they are
                not predictions. Not SEBI-registered. Do your own research.
              </p>
            </footer>
          </div>
        </div>
      </main>
      <Chat
        open={chatOpen}
        onOpenChange={setChatOpen}
        setCustomFormula={setCustomFormula}
        screen={screen}
        onSelectStock={(s) => {
          setSelected(s);
          setChatOpen(false);
        }}
      />
      <MobileNav tab={tab} onChange={setTab} />
    </div>
  );
}
