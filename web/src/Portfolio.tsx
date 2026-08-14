import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, TriangleAlert, Info, Loader2, Download, Pencil,
  AlertOctagon, CircleAlert, CircleCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Disclosure } from './Disclosure';
import { Callout } from './Callout';
import {
  analysePortfolio, analyseCorrelation, analysePerformance, parseHoldings, deriveFindings,
  type Correlation, type Holding, type PortfolioAnalysis, type Performance,
} from '@/lib/portfolio';
import { Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { SegmentedControl } from './SegmentedControl';
import { scoreColor, type Screen } from './types';

const STORAGE = 'ml-portfolio';

function readSavedPortfolio(): { holdings: Holding[]; notice: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return { holdings: [], notice: null };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('saved value is not a list');
    const valid = new Map<string, Holding>();
    let removed = 0;
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        removed += 1;
        continue;
      }
      const row = item as Record<string, unknown>;
      const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
      const qty = typeof row.qty === 'number' ? row.qty : Number.NaN;
      const avgPrice = row.avgPrice == null ? null : typeof row.avgPrice === 'number' ? row.avgPrice : Number.NaN;
      if (!/^[A-Z][A-Z0-9&.-]{1,20}$/.test(symbol) || !Number.isFinite(qty) || qty <= 0 || (avgPrice != null && (!Number.isFinite(avgPrice) || avgPrice <= 0))) {
        removed += 1;
        continue;
      }
      if (valid.has(symbol)) removed += 1;
      valid.set(symbol, { symbol, qty, avgPrice });
    }
    return {
      holdings: [...valid.values()],
      notice: removed ? `${removed} invalid or duplicate saved row${removed === 1 ? ' was' : 's were'} removed. Review the remaining holdings before relying on this analysis.` : null,
    };
  } catch {
    return {
      holdings: [],
      notice: 'The saved portfolio could not be read, so it was not used. Start again or clear the damaged browser copy.',
    };
  }
}

function money(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null | undefined, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
}

/** Proportions (weights, shares). No sign: "+39% of portfolio" reads as a gain. */
function share(v: number | null | undefined, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/** Sub-session exits round to "0.0d", which reads as an error rather than "instant". */
function exitTime(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v < 0.1) return '<1 session';
  if (v < 1) return `${v.toFixed(1)} sessions`;
  return `${v.toFixed(1)} sessions`;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="t-label">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? 'text-foreground'}`}>{value}</div>
      {hint && <div className="mt-0.5 t-meta text-muted-foreground">{hint}</div>}
    </div>
  );
}

function WeightBar({ rows }: { rows: { key: string; weight: number }[] }) {
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 8).map((r) => (
        <div key={r.key} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-muted-foreground">{r.key}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(r.weight * 100, 100)}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right tabular-nums text-foreground">
            {(r.weight * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function PortfolioBody({
  screen,
  onSelectStock,
  onDone,
}: {
  screen: Screen;
  onSelectStock: (symbol: string) => void;
  /** Called when navigating away, so a sheet host can close itself. */
  onDone?: () => void;
}) {
  const open = true;
  const onOpenChange = (v: boolean) => {
    if (!v) onDone?.();
  };
  const [saved] = useState(readSavedPortfolio);
  const [holdings, setHoldings] = useState<Holding[]>(saved.holdings);
  const [storageNotice, setStorageNotice] = useState<string | null>(saved.notice);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [qty, setQty] = useState('');
  const [avg, setAvg] = useState('');
  const [corr, setCorr] = useState<Correlation | null>(null);
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrError, setCorrError] = useState(false);
  const [corrAttempt, setCorrAttempt] = useState(0);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfError, setPerfError] = useState(false);
  const [perfAttempt, setPerfAttempt] = useState(0);
  const [entry, setEntry] = useState<'single' | 'paste'>('single');
  const [paste, setPaste] = useState('');
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const [showEntry, setShowEntry] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(holdings));
    } catch {
      setStorageNotice('Changes are visible now but could not be saved in this browser. Export a copy before leaving this page.');
    }
  }, [holdings]);

  const analysis: PortfolioAnalysis | null = useMemo(
    () => (holdings.length ? analysePortfolio(holdings, screen) : null),
    [holdings, screen],
  );

  useEffect(() => {
    if (!open || holdings.length < 2) {
      setCorr(null);
      return;
    }
    let cancelled = false;
    setCorrLoading(true);
    setCorrError(false);
    analyseCorrelation(holdings.map((h) => h.symbol))
      .then((c) => !cancelled && setCorr(c))
      .catch(() => {
        if (!cancelled) {
          setCorr(null);
          setCorrError(true);
        }
      })
      .finally(() => !cancelled && setCorrLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, holdings, corrAttempt]);

  useEffect(() => {
    if (!open || !analysis) {
      setPerf(null);
      return;
    }
    let cancelled = false;
    setPerfLoading(true);
    setPerfError(false);
    analysePerformance(analysis.holdings)
      .then((r) => !cancelled && setPerf(r))
      .catch(() => {
        if (!cancelled) {
          setPerf(null);
          setPerfError(true);
        }
      })
      .finally(() => !cancelled && setPerfLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, analysis, perfAttempt]);

  const findings = useMemo(
    () => (analysis ? deriveFindings(analysis, perf) : []),
    [analysis, perf],
  );
  const sessionLabel = screen.last_trading_session || 'session unavailable';

  const importPasted = () => {
    const { holdings: parsed, skipped } = parseHoldings(paste);
    if (!parsed.length) {
      setPasteMsg('Nothing recognisable. Use one holding per line: SYMBOL, quantity, average price.');
      return;
    }
    const known = new Set(screen.stocks.map((stock) => stock.symbol.toUpperCase()));
    const recognised = parsed.filter((holding) => known.has(holding.symbol));
    const unknown = parsed.filter((holding) => !known.has(holding.symbol));
    if (!recognised.length) {
      setPasteMsg(`No current-universe ticker was found. Unknown: ${unknown.map((holding) => holding.symbol).join(', ') || 'none'}.`);
      return;
    }
    let updated = 0;
    setHoldings((prev) => {
      const merged = new Map(prev.map((h) => [h.symbol.toUpperCase(), h]));
      recognised.forEach((h) => {
        if (merged.has(h.symbol.toUpperCase())) updated += 1;
        merged.set(h.symbol.toUpperCase(), h);
      });
      return [...merged.values()];
    });
    setPaste('');
    setShowEntry(false);
    setPasteMsg(
      `${updated ? `Updated ${updated} existing and added ${recognised.length - updated}` : `Added ${recognised.length}`} holding${recognised.length === 1 ? '' : 's'}` +
        (unknown.length ? ` · unknown tickers skipped: ${unknown.map((holding) => holding.symbol).join(', ')}` : '') +
        (skipped.length ? ` · ${skipped.length} unreadable line${skipped.length === 1 ? '' : 's'} skipped` : ''),
    );
  };

  const add = () => {
    const s = symbol.toUpperCase().trim();
    const q = Number(qty);
    const average = avg.trim() ? Number(avg) : null;
    if (!/^[A-Z][A-Z0-9&.-]{1,20}$/.test(s)) {
      setEntryError('Enter a valid NSE symbol, such as RELIANCE.');
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      setEntryError('Quantity must be a number greater than zero.');
      return;
    }
    if (average != null && (!Number.isFinite(average) || average <= 0)) {
      setEntryError('Average price must be greater than zero, or left blank.');
      return;
    }
    if (!screen.stocks.some((stock) => stock.symbol.toUpperCase() === s)) {
      setEntryError(`${s} is not in the current scored universe. It was not added because price, risk, and liquidity could not be verified.`);
      return;
    }
    const duplicate = holdings.some((holding) => holding.symbol.toUpperCase() === s);
    setHoldings((prev) => [
      ...prev.filter((h) => h.symbol.toUpperCase() !== s),
      { symbol: s, qty: q, avgPrice: average },
    ]);
    setEntryError(duplicate ? `${s} already existed, so its quantity and average price were updated.` : null);
    setSymbol('');
    setQty('');
    setAvg('');
  };

  const exportCsv = () => {
    if (!analysis) return;
    const head = ['symbol', 'qty', 'avg_price', 'last_close', 'value', 'weight_pct', 'pnl', 'pnl_pct', 'risk_level', 'days_to_exit'];
    const body = analysis.holdings.map((h) => [
      h.holding.symbol, h.holding.qty, h.holding.avgPrice ?? '', h.price ?? '',
      h.value?.toFixed(2) ?? '', (h.weight * 100).toFixed(2), h.pnl?.toFixed(2) ?? '',
      h.pnlPct != null ? (h.pnlPct * 100).toFixed(2) : '', h.stock?.risk_level ?? '',
      h.daysToExit?.toFixed(2) ?? '',
    ].join(','));
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portfolio-${screen.last_trading_session || 'unknown-session'}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
            {storageNotice && (
              <Callout tone="warning" title="Portfolio storage needs attention">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{storageNotice}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      try {
                        localStorage.removeItem(STORAGE);
                        setStorageNotice(null);
                      } catch {
                        setStorageNotice('Browser storage is unavailable. This portfolio will remain session-only.');
                      }
                    }}
                  >
                    Clear saved copy
                  </Button>
                </div>
              </Callout>
            )}
            {holdings.length > 0 && !showEntry ? (
              <div className="flex items-center gap-2">
                <span className="t-body text-muted-foreground">
                  {holdings.length} holding{holdings.length === 1 ? '' : 's'}
                </span>
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => setShowEntry(true)}>
                  <Pencil className="size-3" /> Edit holdings
                </Button>
              </div>
            ) : (
            <>
            <SegmentedControl
              label="How to add holdings"
              value={entry}
              onChange={setEntry}
              size="sm"
              items={[
                { value: 'single', label: 'Add one' },
                { value: 'paste', label: 'Paste list' },
              ]}
            />

            {entry === 'paste' && (
              <div className="space-y-2">
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={6}
                  aria-label="Paste holdings"
                  placeholder={'RELIANCE, 50, 2840\nTCS, 20, 3900\nHDFCBANK, 100'}
                  className="w-full rounded-lg border bg-transparent p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <p className="t-meta text-muted-foreground">
                  One per line: symbol, quantity, average price. Average price is optional. Commas or
                  tabs both work, so most broker exports paste straight in.
                </p>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" onClick={importPasted} disabled={!paste.trim()}>
                    Import
                  </Button>
                  {pasteMsg && <span className="t-meta text-muted-foreground">{pasteMsg}</span>}
                </div>
              </div>
            )}

            {entry === 'single' && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  add();
                }}
                className="flex flex-wrap items-end gap-2"
              >
                <div className="min-w-28 flex-1">
                  <label className="t-label" htmlFor="portfolio-symbol">Symbol</label>
                  <Input id="portfolio-symbol" value={symbol} onChange={(e) => { setSymbol(e.target.value); setEntryError(null); }} placeholder="RELIANCE" list="ml-symbols" aria-invalid={!!entryError} aria-describedby={entryError ? 'portfolio-entry-error' : undefined} />
                </div>
                <div className="w-24">
                  <label className="t-label" htmlFor="portfolio-quantity">Qty</label>
                  <Input id="portfolio-quantity" value={qty} onChange={(e) => { setQty(e.target.value); setEntryError(null); }} inputMode="decimal" placeholder="100" aria-invalid={!!entryError} aria-describedby={entryError ? 'portfolio-entry-error' : undefined} />
                </div>
                <div className="w-28">
                  <label className="t-label" htmlFor="portfolio-average">Avg price</label>
                  <Input id="portfolio-average" value={avg} onChange={(e) => { setAvg(e.target.value); setEntryError(null); }} inputMode="decimal" placeholder="optional" aria-invalid={!!entryError} aria-describedby={entryError ? 'portfolio-entry-error' : undefined} />
                </div>
                <Button type="submit" size="icon" className="size-11 sm:size-8">
                  <Plus className="size-4" />
                  <span className="sr-only">Add holding</span>
                </Button>
              </form>
              {entryError && <p id="portfolio-entry-error" role="alert" className="t-body text-danger">{entryError}</p>}
            </>
            )}
            {holdings.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowEntry(false)}>
                Done adding
              </Button>
            )}
            </>
            )}
            <datalist id="ml-symbols">
              {screen.stocks.slice(0, 2000).map((s) => (
                <option key={s.symbol} value={s.symbol} />
              ))}
            </datalist>

            {!analysis && (
              <p className="t-body text-muted-foreground">
                Add your holdings to analyse them against today&rsquo;s official NSE close. Everything is
                computed in this browser and stored only on this device — there is no account and no
                server, so your holdings are never transmitted anywhere.
              </p>
            )}

            {analysis && (
              <>
                {(analysis.coverage < 1 || analysis.unmatched.length > 0 || analysis.holdings.some((holding) => holding.issue)) && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-[13px] text-warning">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {analysis.totalValue > 0 ? `${(analysis.coverage * 100).toFixed(0)}% of priced value could be analysed.` : 'No current value could be calculated.'}
                      {analysis.unmatched.length > 0 && (
                        <> Not found in the scored universe: {analysis.unmatched.join(', ')}.</>
                      )}{' '}
                      Those holdings are excluded from every metric below rather than estimated.
                    </span>
                  </div>
                )}

                {findings.length > 0 && (
                  <Card>
                    <CardContent className="space-y-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground">What stands out</h3>
                        <span className="t-meta text-muted-foreground">
                          {findings.filter((f) => f.severity !== 'good').length} to review
                        </span>
                      </div>
                      <ul className="space-y-2.5">
                        {findings.map((f) => {
                          const Icon =
                            f.severity === 'critical'
                              ? AlertOctagon
                              : f.severity === 'warning'
                                ? CircleAlert
                                : f.severity === 'good'
                                  ? CircleCheck
                                  : Info;
                          const tone =
                            f.severity === 'critical'
                              ? 'text-danger'
                              : f.severity === 'warning'
                                ? 'text-warning'
                                : f.severity === 'good'
                                  ? 'text-success'
                                  : 'text-muted-foreground';
                          return (
                            <li key={f.id} className="flex gap-2.5">
                              <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
                              <div className="min-w-0">
                                <div className="t-body font-medium text-foreground">{f.headline}</div>
                                <div className="t-body text-muted-foreground">{f.detail}</div>
                                {f.symbols && f.symbols.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {f.symbols.slice(0, 6).map((sym) => (
                                      <button
                                        key={sym}
                                        type="button"
                                        onClick={() => {
                                          onSelectStock(sym);
                                          onOpenChange(false);
                                        }}
                                        className="rounded-md border px-1.5 py-0.5 t-meta hover:bg-muted"
                                      >
                                        {sym}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Current value" value={money(analysis.totalValue)} hint={`at ${sessionLabel} close`} />
                  <Stat
                    label="P&L"
                    value={money(analysis.totalPnl)}
                    hint={analysis.totalInvested == null ? 'add avg prices' : `on ${money(analysis.totalInvested)} invested`}
                    tone={analysis.totalPnl == null ? undefined : analysis.totalPnl >= 0 ? 'text-success' : 'text-danger'}
                  />
                  <Stat
                    label="Return"
                    value={pct(analysis.totalPnlPct)}
                    hint="cost basis only"
                    tone={analysis.totalPnlPct == null ? undefined : analysis.totalPnlPct >= 0 ? 'text-success' : 'text-danger'}
                  />
                  <Stat
                    label="Holdings"
                    value={String(analysis.holdings.length)}
                    hint={`${analysis.concentration.effectiveHoldings.toFixed(1)} effective`}
                  />
                </div>

                {/* Concentration — the risk most retail portfolios actually carry. */}
                <Card>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground">Concentration</h3>
                      <Badge variant={analysis.concentration.hhi > 0.25 ? 'destructive' : 'secondary'}>
                        {analysis.concentration.hhi > 0.25
                          ? 'concentrated'
                          : analysis.concentration.hhi > 0.15
                            ? 'moderate'
                            : 'diversified'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Stat label="Largest holding" value={share(analysis.concentration.topWeight)} />
                      <Stat label="Top 3" value={share(analysis.concentration.top3Weight)} />
                      <Stat label="Effective holdings" value={analysis.concentration.effectiveHoldings.toFixed(1)} />
                    </div>
                    <p className="t-body text-muted-foreground">
                      Effective holdings is 1/HHI: {analysis.holdings.length} positions weighted like this
                      carry the same concentration as {analysis.concentration.effectiveHoldings.toFixed(1)}{' '}
                      equally-sized ones.
                    </p>
                  </CardContent>
                </Card>

                {/* Liquidity — the constraint almost no free tool shows. */}
                <Card>
                  <CardContent className="space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">Exit liquidity</h3>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat
                        label="Median exit time"
                        value={exitTime(analysis.liquidity.medianDaysToExit)}
                      />
                      <Stat
                        label="Slowest holding"
                        value={exitTime(analysis.liquidity.worstDaysToExit)}
                        tone={(analysis.liquidity.worstDaysToExit ?? 0) > 5 ? 'text-warning' : undefined}
                      />
                      <Stat label="Illiquid weight" value={share(analysis.liquidity.illiquidWeight)} hint=">5 sessions" />
                    </div>
                    <p className="t-body text-muted-foreground">
                      Sessions to unwind at 10% of each stock&rsquo;s median daily traded value, from NSE
                      bhavcopy turnover. Selling faster than this is what moves the price against you.
                    </p>
                  </CardContent>
                </Card>

                {/* Correlation from real returns. */}
                <Card>
                  <CardContent className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">Diversification check</h3>
                    {corrLoading && (
                      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Correlating daily returns…
                      </div>
                    )}
                    {!corrLoading && corr?.average != null && (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className={`text-2xl font-semibold tabular-nums ${corr.average > 0.7 ? 'text-warning' : 'text-foreground'}`}>
                            {corr.average.toFixed(2)}
                          </span>
                          <span className="text-[13px] text-muted-foreground">
                            average pairwise correlation over {corr.sessions} sessions
                          </span>
                        </div>
                        <p className="t-body text-muted-foreground">
                          {corr.average > 0.7
                            ? 'These holdings move almost together. The position count overstates how diversified this is.'
                            : corr.average > 0.4
                              ? 'Moderately correlated — normal for a single-market equity portfolio.'
                              : 'Genuinely varied return streams.'}{' '}
                          Computed from actual daily closes, not sector labels.
                        </p>
                      </>
                    )}
                    {!corrLoading && !corrError && corr?.average == null && (
                      <p className="text-[13px] text-muted-foreground">
                        Needs at least two holdings with a year of shared price history.
                      </p>
                    )}
                    {!corrLoading && corrError && (
                      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
                        <span>Price histories could not be loaded, so correlation is unavailable rather than estimated.</span>
                        <Button variant="outline" size="sm" onClick={() => setCorrAttempt((attempt) => attempt + 1)}>Retry</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Behaviour of this exact mix under real market moves. */}
                <Card>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-foreground">How this mix behaves</h3>
                      {perf && (
                        <span className="t-meta text-muted-foreground">
                          {perf.sessions} sessions of real prices
                        </span>
                      )}
                    </div>

                    {perfLoading && (
                      <div className="flex items-center gap-2 t-body text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Reading price history…
                      </div>
                    )}

                    {!perfLoading && perf && (
                      <>
                        <div
                          className="h-52"
                          role="img"
                          aria-label={`Historical behavior of the current portfolio mix. Return ${pct(perf.totalReturn)}, market ${pct(perf.benchmarkReturn)}, volatility ${perf.annualisedVol != null ? `${(perf.annualisedVol * 100).toFixed(0)}%` : 'unavailable'}, worst fall ${pct(perf.maxDrawdown)}.`}
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={perf.dates.map((d, i) => ({
                                date: d,
                                Portfolio: perf.portfolio[i + 1] ?? perf.portfolio[i],
                                Market: perf.benchmark[i + 1] ?? perf.benchmark[i],
                              }))}
                            >
                              <CartesianGrid stroke="var(--border)" vertical={false} />
                              <XAxis dataKey="date" hide />
                              <YAxis
                                domain={['auto', 'auto']}
                                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                                width={44}
                              />
                              <RTooltip
                                contentStyle={{
                                  borderRadius: 'var(--radius)',
                                  background: 'var(--popover)',
                                  color: 'var(--popover-foreground)',
                                  border: '1px solid var(--border)',
                                  fontSize: '12px',
                                }}
                                formatter={(v: unknown) => Number(v).toFixed(1)}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px' }} />
                              <Area type="monotone" dataKey="Portfolio" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.12} strokeWidth={2} />
                              <Line type="monotone" dataKey="Market" stroke="var(--muted-foreground)" strokeWidth={1.5} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <Stat
                            label="This mix"
                            value={pct(perf.totalReturn)}
                            hint="over the window"
                            tone={(perf.totalReturn ?? 0) >= 0 ? 'text-success' : 'text-danger'}
                          />
                          <Stat label="Market" value={pct(perf.benchmarkReturn)} hint="equal-weighted NSE" />
                          <Stat
                            label="Volatility"
                            value={perf.annualisedVol != null ? `${(perf.annualisedVol * 100).toFixed(0)}%` : '—'}
                            hint={perf.benchmarkVol != null ? `market ${(perf.benchmarkVol * 100).toFixed(0)}%` : undefined}
                          />
                          <Stat
                            label="Worst fall"
                            value={pct(perf.maxDrawdown)}
                            hint="peak to trough"
                            tone="text-danger"
                          />
                          <Stat
                            label="Beta"
                            value={perf.beta != null ? perf.beta.toFixed(2) : '—'}
                            hint={perf.beta != null ? (perf.beta > 1.1 ? 'swings harder than market' : perf.beta < 0.9 ? 'steadier than market' : 'moves with market') : undefined}
                          />
                          <Stat
                            label="Return per unit risk"
                            value={perf.returnPerUnitRisk != null ? perf.returnPerUnitRisk.toFixed(2) : '—'}
                            hint="higher is better"
                          />
                          <Stat label="From peak" value={pct(perf.currentDrawdown)} hint="today" />
                          <Stat label="Covered" value={share(perf.coverage)} hint="of portfolio value" />
                        </div>

                        <Callout tone="warning">
                          This applies <strong>today&rsquo;s</strong> weights to past prices. It is not what you
                          actually earned — you did not hold these weights back then, and anything you have
                          since sold is missing. Read it as how this mix behaves, never as your track record.
                        </Callout>
                      </>
                    )}

                    {!perfLoading && !perf && !perfError && (
                      <p className="t-body text-muted-foreground">
                        Needs at least one holding with a few months of shared price history.
                      </p>
                    )}
                    {!perfLoading && perfError && (
                      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 t-body text-muted-foreground">
                        <span>Price history failed to load. Historical behavior and risk contribution are unavailable, not zero.</span>
                        <Button variant="outline" size="sm" onClick={() => setPerfAttempt((attempt) => attempt + 1)}>Retry history</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Weight and risk are different things, and the gap is where people get hurt. */}
                {perf && perf.riskContributions.length > 1 && (
                  <Disclosure
                    title="What actually drives your risk"
                    summary="Share of portfolio volatility per holding, next to its share of value."
                  >
                    <div className="space-y-2">
                      {perf.riskContributions.slice(0, 10).map((r) => {
                        const heavier = r.riskShare > r.weight * 1.25;
                        return (
                          <div key={r.symbol} className="flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              className="w-24 shrink-0 truncate text-left font-medium hover:underline"
                              onClick={() => {
                                onSelectStock(r.symbol);
                                onOpenChange(false);
                              }}
                            >
                              {r.symbol}
                            </button>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className={heavier ? 'h-full rounded-full bg-warning' : 'h-full rounded-full bg-primary'}
                                style={{ width: `${Math.min(Math.max(r.riskShare, 0) * 100, 100)}%` }}
                              />
                            </div>
                            <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
                              {(r.riskShare * 100).toFixed(0)}% risk / {(r.weight * 100).toFixed(0)}% value
                            </span>
                          </div>
                        );
                      })}
                      <p className="t-meta text-muted-foreground">
                        Amber means the holding contributes noticeably more volatility than its size
                        suggests. A 5% position driving 20% of your risk is a position you are more
                        exposed to than you think.
                      </p>
                    </div>
                  </Disclosure>
                )}

                {perf && perf.redundantPairs.length > 0 && (
                  <Callout tone="warning" title="Some holdings are near-duplicates">
                    {perf.redundantPairs
                      .map((p) => `${p.a} and ${p.b} (${p.correlation.toFixed(2)})`)
                      .join(', ')}
                    . Pairs this correlated behave as one position, so they diversify far less than the
                    holding count implies.
                  </Callout>
                )}

                <Disclosure title="Exposure by sector and size" summary="Where the money actually sits.">
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sector</div>
                      <WeightBar rows={analysis.bySector} />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Size bucket</div>
                      <WeightBar rows={analysis.byBucket} />
                    </div>
                  </div>
                </Disclosure>

                <Disclosure title="Factor and risk profile" summary="Value-weighted scores of what you hold.">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {analysis.factors.map((f) => (
                        <Stat
                          key={f.pillar}
                          label={f.pillar}
                          value={f.score != null ? f.score.toFixed(0) : '—'}
                          tone={scoreColor(f.score)}
                        />
                      ))}
                      <Stat
                        label="Risk score"
                        value={analysis.risk.weightedRiskScore != null ? analysis.risk.weightedRiskScore.toFixed(0) : '—'}
                        hint="higher = safer"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="High-risk weight" value={share(analysis.risk.highRiskWeight)} />
                      <Stat label="In F&O ban" value={share(analysis.risk.fnoBanWeight)} />
                      <Stat label="Risk unavailable" value={share(analysis.risk.unknownRiskWeight)} />
                      <Stat label="Liquidity unavailable" value={share(analysis.liquidity.unknownLiquidityWeight)} />
                      <Stat label="Price data only" value={share(analysis.risk.technicalOnlyWeight)} hint="no fundamentals available" />
                      <Stat label="Unrated" value={share(analysis.risk.unratedWeight)} />
                    </div>
                    <p className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
                      <Info className="mt-0.5 size-3.5 shrink-0" />
                      Each score is the value-weighted average of holdings that had that metric. Holdings
                      missing a metric are left out of it entirely rather than counted as average.
                    </p>
                  </div>
                </Disclosure>

                <Disclosure title={`All ${analysis.holdings.length} holdings`} summary="Line by line, with the exit constraint.">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="py-1 font-medium">Stock</th>
                          <th className="py-1 text-right font-medium">Value</th>
                          <th className="py-1 text-right font-medium">Weight</th>
                          <th className="py-1 text-right font-medium">P&L</th>
                          <th className="py-1 text-right font-medium">Exit</th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {analysis.holdings.map((h) => (
                          <tr key={h.holding.symbol}>
                            <td className="py-1.5">
                              <button
                                type="button"
                                className="font-medium text-foreground hover:underline"
                                onClick={() => {
                                  onSelectStock(h.holding.symbol);
                                  onOpenChange(false);
                                }}
                              >
                                {h.holding.symbol}
                              </button>
                              <div className="t-meta text-muted-foreground">
                                {h.holding.qty} @ {h.price != null ? `₹${h.price}` : '—'}
                              </div>
                              {h.issue && <div className="text-[10px] text-warning">{h.issue}</div>}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{money(h.value)}</td>
                            <td className="py-1.5 text-right tabular-nums">{(h.weight * 100).toFixed(1)}%</td>
                            <td className={`py-1.5 text-right tabular-nums ${h.pnl == null ? '' : h.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                              {h.pnlPct != null ? pct(h.pnlPct) : '—'}
                            </td>
                            <td className={`py-1.5 text-right tabular-nums ${(h.daysToExit ?? 0) > 5 ? 'text-warning' : 'text-muted-foreground'}`}>
                              {exitTime(h.daysToExit)}
                            </td>
                            <td className="py-1.5 text-right">
                              <button
                                type="button"
                                onClick={() => setHoldings((prev) => prev.filter((x) => x.symbol !== h.holding.symbol))}
                                aria-label={`Remove ${h.holding.symbol}`}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Disclosure>

                <Disclosure title="How every number here was produced" summary="Sources and formulas, in full.">
                  <ul className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
                    <li><span className="text-foreground">Price</span> — official NSE bhavcopy close for {sessionLabel}. Not a live tick.</li>
                    <li><span className="text-foreground">Value</span> — quantity x that close. <span className="text-foreground">P&L</span> — value minus (avg price x quantity), only for holdings where you supplied a cost basis.</li>
                    <li><span className="text-foreground">Concentration</span> — HHI = sum of squared weights; effective holdings = 1/HHI.</li>
                    <li><span className="text-foreground">Exit days</span> — position value / (median daily traded value x 10%), using NSE turnover.</li>
                    <li><span className="text-foreground">Correlation</span> — Pearson correlation of daily returns from bhavcopy closes over the shared window.</li>
                    <li><span className="text-foreground">Factor scores</span> — value-weighted averages of the same percentile ranks shown on the board.</li>
                    <li>Nothing is estimated or back-filled. A missing input is reported as unavailable.</li>
                  </ul>
                </Disclosure>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={exportCsv}>
                    <Download className="size-3" /> Export CSV
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHoldings([]);
                      setStorageNotice(null);
                    }}
                    className="text-muted-foreground"
                  >
                    Clear portfolio
                  </Button>
                </div>
              </>
            )}
    </div>
  );
}
