import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Building2, ChevronRight, ChevronsUpDown, Download, Info, Search, SearchX,
  ShieldCheck, TrendingDown, TrendingUp, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Callout } from './Callout';
import { Disclosure } from './Disclosure';
import { SegmentedControl } from './SegmentedControl';
import { Pagination } from './Pagination';
import { downloadCsv } from './lib/columns';
import type { Investor, InvestorPortfolio, Screen } from './types';

/**
 * Who has been buying and selling, by name.
 *
 * Two views, because the two data sources answer different questions. "Portfolios" comes
 * from the quarterly shareholding pattern and shows what someone holds. "Recent activity"
 * comes from SAST filings and bulk/block deals and shows what they did — which is
 * event-driven, so an investor quietly holding 4% files nothing and appears nowhere.
 * Calling either one a complete portfolio would imply a completeness the data lacks.
 */
type KindFilter = 'all' | 'individual' | 'mutual_fund' | 'fii' | 'dii';
type View = 'holdings' | 'activity';
type PortfolioSort = 'name' | 'stocks' | 'largest_stake';
type ActivitySort = 'name' | 'stocks' | 'buys' | 'sells' | 'latest_date';

const KIND_LABEL: Record<string, string> = {
  individual: 'Individual',
  mutual_fund: 'Mutual fund',
  fii: 'FII / foreign',
  dii: 'DII',
  government: 'Government',
  corporate: 'Corporate',
  aif: 'AIF',
  trust: 'Trust',
  promoter: 'Promoter',
  institution: 'Institution',
  intermediary: 'Broker / prop desk',
  investor: 'Investor',
  other: 'Other',
};

function KindBadge({ kind }: { kind: string }) {
  const tone =
    kind === 'individual'
      ? 'border-success/30 bg-success-subtle text-success'
      : kind === 'promoter' || kind === 'mutual_fund' || kind === 'dii' || kind === 'fii'
        ? 'border-primary/30 bg-primary/10 text-primary'
        : 'text-muted-foreground';
  return (
    <Badge variant="outline" className={tone}>
      {KIND_LABEL[kind] ?? kind}
    </Badge>
  );
}

function Avatar({ kind }: { kind: string }) {
  const Icon = kind === 'promoter' ? ShieldCheck : kind === 'individual' ? Users : Building2;
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
      <Icon className="size-3.5" />
    </span>
  );
}

function SortHeader<K extends string>({
  label, k, active, desc, onSort, numeric, width,
}: {
  label: string;
  k: K;
  active: boolean;
  desc: boolean;
  onSort: (k: K) => void;
  numeric?: boolean;
  width?: number;
}) {
  return (
    <TableHead
      style={width ? { width, minWidth: width } : undefined}
      className={`px-3 py-2 font-normal ${numeric ? 'text-right' : 'text-left'}`}
      aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSort(k)}
        className={`group h-7 px-1 ${numeric ? 'ml-auto' : ''} ${active ? 'text-foreground' : ''}`}
      >
        {label}
        {active ? (
          desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
        ) : (
          <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-40" />
        )}
      </Button>
    </TableHead>
  );
}

function Empty({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <SearchX className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No investors match this filter</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Coverage grows with each quarterly filing. Try another category or clear the search.
      </p>
      <Button variant="outline" size="sm" className="mt-1" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

export function Investors({
  screen,
  onSelectStock,
}: {
  screen: Screen;
  onSelectStock: (symbol: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<View>('holdings');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [pSort, setPSort] = useState<PortfolioSort>('stocks');
  const [aSort, setASort] = useState<ActivitySort>('stocks');
  const [desc, setDesc] = useState(true);

  useEffect(() => setPage(0), [view, kind, query, pageSize, pSort, aSort, desc]);

  const all = screen.investors ?? [];
  const portfolios = screen.investor_holdings ?? [];

  const portfolioRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = portfolios.filter((p: InvestorPortfolio) => {
      if (kind !== 'all' && p.kind !== kind) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.holdings.some((h) => h.symbol.toLowerCase().includes(q));
    });
    return [...out].sort((a, b) => {
      if (pSort === 'name') return desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      const av = a[pSort] ?? 0;
      const bv = b[pSort] ?? 0;
      return desc ? bv - av : av - bv;
    });
  }, [portfolios, kind, query, pSort, desc]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = all.filter((i: Investor) => {
      if (kind !== 'all' && i.kind !== kind) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || i.positions.some((p) => p.symbol.toLowerCase().includes(q));
    });
    return [...out].sort((a, b) => {
      if (aSort === 'name') return desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      if (aSort === 'latest_date') {
        const av = a.latest_date ?? '';
        const bv = b.latest_date ?? '';
        return desc ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      const av = a[aSort] ?? 0;
      const bv = b[aSort] ?? 0;
      return desc ? bv - av : av - bv;
    });
  }, [all, kind, query, aSort, desc]);

  const active = view === 'holdings' ? portfolioRows : rows;
  const pages = Math.max(1, Math.ceil(active.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const slice = active.slice(safePage * pageSize, safePage * pageSize + pageSize);

  function sortPortfolios(k: PortfolioSort) {
    if (k === pSort) setDesc(!desc);
    else {
      setPSort(k);
      setDesc(k !== 'name');
    }
  }

  function sortActivity(k: ActivitySort) {
    if (k === aSort) setDesc(!desc);
    else {
      setASort(k);
      setDesc(k !== 'name');
    }
  }

  function clearFilters() {
    setQuery('');
    setKind('all');
  }

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    const esc = (v: string | number | null) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv =
      view === 'holdings'
        ? [
            'Investor,Type,Holdings,Largest stake %,As of,Stock,Stake %',
            ...portfolioRows.flatMap((p) =>
              p.holdings.map((h) =>
                [p.name, KIND_LABEL[p.kind] ?? p.kind, p.stocks, p.largest_stake, p.as_of, h.symbol, h.pct]
                  .map(esc).join(','),
              ),
            ),
          ].join('\n')
        : [
            'Investor,Type,Stocks,Buys,Sells,Stock,Action,Stake %,Date,Source',
            ...rows.flatMap((i) =>
              i.positions.map((p) =>
                [i.name, KIND_LABEL[i.kind] ?? i.kind, i.stocks, i.buys, i.sells, p.symbol, p.action, p.stake, p.when, p.source]
                  .map(esc).join(','),
              ),
            ),
          ].join('\n');
    downloadCsv(`market-lab-investors-${view}-${stamp}.csv`, csv);
  }

  if (!all.length && !portfolios.length) {
    return (
      <Callout tone="info" title="No disclosures cached yet">
        This view is built from quarterly shareholding filings, SEBI SAST disclosures and bulk/block
        deals. Run a refresh to fetch them, and the list grows each day as new filings arrive.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      {/* The caveat is essential but it is not the answer, and at full length it filled a
          phone screen before a single investor appeared. One line always, the rest on ask. */}
      <Disclosure
        title="Disclosed holdings, not a complete portfolio"
        summary="What these numbers can and cannot tell you"
        icon={<Info className="size-4" />}
      >
        <p className="t-body leading-relaxed text-muted-foreground">
          Portfolios come from the quarterly shareholding pattern, which names every public holder
          above 1% of a company. Anything below that threshold, and anything held outside listed
          Indian equity, is invisible here. Recent activity comes from event-driven SAST and deal
          filings, so someone sitting quietly on a stake files nothing and will not appear.
        </p>
      </Disclosure>

      {portfolios.length > 0 && (
        <SegmentedControl
          label="What to show"
          value={view}
          onChange={setView}
          items={[
            { value: 'holdings', label: 'Portfolios' },
            { value: 'activity', label: 'Recent activity' },
          ]}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-full flex-1 sm:min-w-56">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search investor or stock…"
            className="h-11 pl-9 text-base sm:h-8 sm:text-sm"
          />
        </div>
        <SegmentedControl
          label="Filer type"
          value={kind}
          onChange={setKind}
          size="sm"
          className="w-auto"
          items={[
            { value: 'all', label: 'All' },
            { value: 'individual', label: 'Individuals' },
            { value: 'mutual_fund', label: 'Mutual funds' },
            { value: 'dii', label: 'DIIs' },
            { value: 'fii', label: 'FIIs' },
          ]}
        />
        <span className="t-body text-muted-foreground">
          {active.length.toLocaleString('en-IN')} {view === 'holdings' ? 'investors' : 'filers'}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-11 sm:h-8"
          onClick={exportCsv}
          disabled={!active.length}
          title="Download every matching investor and their disclosed stocks"
        >
          <Download className="size-4" />
          Export
        </Button>
      </div>

      <Card className="overflow-hidden">
        {active.length === 0 ? (
          <Empty onClear={clearFilters} />
        ) : (
          <>
            {/* A 720px table in a 390px viewport is a horizontal-scroll puzzle. Phones get
                the same information stacked, the way the screener already does. */}
            <div className="divide-y md:hidden">
              {slice.map((row, idx) => {
                const inv = row as InvestorPortfolio & Investor;
                const id = `${view}-${inv.name}`;
                const expanded = open === id;
                return (
                  <div key={id} className="px-4 py-3">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : id)}
                      className="flex w-full items-start gap-3 text-left"
                    >
                      <span className="t-meta w-5 shrink-0 pt-1 tabular-nums text-muted-foreground">
                        {safePage * pageSize + idx + 1}
                      </span>
                      <Avatar kind={inv.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">{inv.name}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <KindBadge kind={inv.kind} />
                          <span className="t-meta text-muted-foreground">
                            {view === 'holdings'
                              ? `${inv.stocks} holdings · largest ${inv.largest_stake?.toFixed(2)}%`
                              : `${inv.stocks} stocks · ${inv.buys} buys, ${inv.sells} sells`}
                          </span>
                        </span>
                      </span>
                      <ChevronRight
                        className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
                      />
                    </button>

                    <div className="mt-2 flex flex-wrap gap-1 ps-8">
                      {view === 'holdings'
                        ? inv.holdings.slice(0, expanded ? inv.holdings.length : 3).map((h) => (
                            <Badge key={h.symbol} variant="secondary" className="font-normal">
                              {h.symbol}
                              {h.pct != null && (
                                <span className="ml-1 tabular-nums text-muted-foreground">{h.pct}%</span>
                              )}
                            </Badge>
                          ))
                        : inv.positions.slice(0, expanded ? inv.positions.length : 3).map((pos) => (
                            <Badge key={`${pos.symbol}-${pos.when}`} variant="secondary" className="font-normal">
                              {pos.symbol}
                              <span className={`ml-1 ${pos.action === 'bought' ? 'text-success' : 'text-warning'}`}>
                                {pos.action}
                              </span>
                            </Badge>
                          ))}
                      {!expanded && inv.stocks > 3 && (
                        <span className="t-meta text-muted-foreground">+{inv.stocks - 3} more</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[720px]">
                <TableHeader className="bg-background text-xs text-muted-foreground">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 px-3 py-2 font-normal">#</TableHead>
                    {view === 'holdings' ? (
                      <>
                        <SortHeader label="Investor" k="name" active={pSort === 'name'} desc={desc} onSort={sortPortfolios} width={280} />
                        <SortHeader label="Holdings" k="stocks" active={pSort === 'stocks'} desc={desc} onSort={sortPortfolios} numeric width={100} />
                        <SortHeader label="Largest stake" k="largest_stake" active={pSort === 'largest_stake'} desc={desc} onSort={sortPortfolios} numeric width={120} />
                        <TableHead className="px-3 py-2 font-normal">Top holdings</TableHead>
                        <TableHead className="w-24 px-3 py-2 text-right font-normal">As of</TableHead>
                      </>
                    ) : (
                      <>
                        <SortHeader label="Investor" k="name" active={aSort === 'name'} desc={desc} onSort={sortActivity} width={280} />
                        <SortHeader label="Stocks" k="stocks" active={aSort === 'stocks'} desc={desc} onSort={sortActivity} numeric width={90} />
                        <SortHeader label="Buys" k="buys" active={aSort === 'buys'} desc={desc} onSort={sortActivity} numeric width={80} />
                        <SortHeader label="Sells" k="sells" active={aSort === 'sells'} desc={desc} onSort={sortActivity} numeric width={80} />
                        <TableHead className="px-3 py-2 font-normal">Latest disclosure</TableHead>
                        <SortHeader label="Date" k="latest_date" active={aSort === 'latest_date'} desc={desc} onSort={sortActivity} numeric width={110} />
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slice.map((row, idx) => {
                    const id = `${view}-${row.name}`;
                    const expanded = open === id;
                    const inv = row as InvestorPortfolio & Investor;
                    return (
                      <Fragment key={id}>
                        <TableRow
                          data-investor={inv.name}
                          onClick={() => setOpen(expanded ? null : id)}
                          className={`cursor-pointer ${idx % 2 ? 'bg-muted/30' : ''}`}
                        >
                          <TableCell className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">
                            {safePage * pageSize + idx + 1}
                          </TableCell>
                          <TableCell className="px-3 py-2.5">
                            {/* The row is clickable for convenience, but the disclosure state has
                                to live on a real control — aria-expanded on a table row is only
                                meaningful inside a treegrid. */}
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpen(expanded ? null : id);
                              }}
                              className="flex w-full items-center gap-2 text-left"
                            >
                              <ChevronRight
                                className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
                              />
                              <Avatar kind={inv.kind} />
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-foreground">{inv.name}</span>
                                <KindBadge kind={inv.kind} />
                              </span>
                            </button>
                          </TableCell>

                          {view === 'holdings' ? (
                            <>
                              <TableCell className="px-3 py-2.5 text-right tabular-nums">{inv.stocks}</TableCell>
                              <TableCell className="px-3 py-2.5 text-right tabular-nums">
                                {inv.largest_stake?.toFixed(2) ?? '—'}%
                              </TableCell>
                              <TableCell className="px-3 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {inv.holdings.slice(0, 4).map((h) => (
                                    <Badge key={h.symbol} variant="secondary" className="font-normal">
                                      {h.symbol}
                                      {h.pct != null && (
                                        <span className="ml-1 tabular-nums text-muted-foreground">{h.pct}%</span>
                                      )}
                                    </Badge>
                                  ))}
                                  {inv.stocks > 4 && (
                                    <span className="t-meta text-muted-foreground">
                                      +{inv.stocks - 4} more
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {inv.as_of ?? '—'}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell className="px-3 py-2.5 text-right tabular-nums">{inv.stocks}</TableCell>
                              <TableCell className="px-3 py-2.5 text-right tabular-nums text-success">{inv.buys}</TableCell>
                              <TableCell className="px-3 py-2.5 text-right tabular-nums text-warning">{inv.sells}</TableCell>
                              <TableCell className="px-3 py-2.5">
                                <span className="inline-flex items-center gap-1.5 text-xs">
                                  {inv.buys > inv.sells ? (
                                    <TrendingUp className="size-3.5 text-success" />
                                  ) : inv.sells > inv.buys ? (
                                    <TrendingDown className="size-3.5 text-warning" />
                                  ) : null}
                                  <span className="text-muted-foreground">{inv.latest_action}</span>
                                  <span className="font-medium text-foreground">{inv.latest_symbol}</span>
                                </span>
                              </TableCell>
                              <TableCell className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {inv.latest_date ?? '—'}
                              </TableCell>
                            </>
                          )}
                        </TableRow>

                        {expanded && (
                          <TableRow key={`${id}-detail`} className="hover:bg-transparent">                            <TableCell colSpan={6} className="border-t bg-muted/30 px-4 py-3">
                              <div className="mb-2 t-label">
                                {view === 'holdings' ? 'Holdings above 1% of the company' : 'Disclosed positions'}
                              </div>
                              {view === 'holdings' && inv.holdings.length < inv.stocks && (
                                <p className="mb-2 t-meta text-muted-foreground">
                                  Showing the {inv.holdings.length} largest of {inv.stocks} disclosed
                                  holdings.
                                </p>
                              )}
                              {/* A large institution discloses ~180 names; without a cap the
                                  expanded row buries every investor beneath it. */}
                              <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
                                {view === 'holdings'
                                  ? inv.holdings.map((h) => (
                                      <Button
                                        key={h.symbol}
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onSelectStock(h.symbol)}
                                        className="h-auto flex-col items-start gap-0.5 py-1.5"
                                      >
                                        <span className="font-medium">{h.symbol}</span>
                                        <span className="t-meta text-muted-foreground">
                                          {h.pct != null ? `${h.pct}% of company` : ''}
                                        </span>
                                      </Button>
                                    ))
                                  : inv.positions.map((p) => (
                                      <Button
                                        key={`${p.symbol}-${p.when}`}
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onSelectStock(p.symbol)}
                                        className="h-auto flex-col items-start gap-0.5 py-1.5"
                                      >
                                        <span className="flex items-center gap-1.5">
                                          <span className="font-medium">{p.symbol}</span>
                                          <span className={p.action === 'bought' ? 'text-success' : 'text-warning'}>
                                            {p.action}
                                          </span>
                                        </span>
                                        <span className="t-meta text-muted-foreground">
                                          {p.stake != null ? `now ${p.stake}% · ` : ''}
                                          {p.when ?? ''} · {p.source}
                                        </span>
                                      </Button>
                                    ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <Pagination
              page={safePage}
              pageSize={pageSize}
              total={active.length}
              onPage={setPage}
              onPageSize={setPageSize}
            />
          </>
        )}
      </Card>
    </div>
  );
}
