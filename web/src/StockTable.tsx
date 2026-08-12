import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Rows3, Rows4, Search, SearchX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { OwnershipBadge } from './OwnershipBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from './Pagination';
import { ColumnPicker } from './ColumnPicker';
import { downloadCsv, orderColumns, presetColumns, toCsv, type Column, type ColumnContext } from './lib/columns';
import {
  scoreColor, formatTurnover, BUCKET_LABEL, HORIZONS,
  type HorizonScoreKey, type Stock,
} from './types';

/** 1,600 rows in the DOM makes every re-render janky. Render one page at a time. */
const DEFAULT_PAGE_SIZE = 50;
const RANK_WIDTH = 48;
const STORE_KEY = 'marketlab.table.v1';

type Persisted = { preset: string | null; columns: string[]; compact: boolean; pageSize: number };

function loadPrefs(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Partial<Persisted>;
  } catch {
    return {};
  }
}


/**
 * Numeric columns keep their exact width; the name column absorbs whatever is left over.
 *
 * Every column having a fixed width meant a five-column view spread 630px of content
 * across the full container and the numbers drifted apart into unreadable islands. Slack
 * belongs in the one column with variable-length content — the company name, which was
 * being truncated at the same time as the table had space to spare.
 */
function colStyle(c: Column): CSSProperties {
  if (c.pinned) return { minWidth: c.width, left: RANK_WIDTH };
  return { width: c.width, minWidth: c.width };
}

export function StockTable({
  stocks,
  selected,
  onSelect,
  rankingKey,
  /**
   * Basic mode starts from a five-column view. Fifteen columns is the right density for
   * someone who reads this every day and pure noise for someone deciding what to look at.
   * Either way the choice is now the user's — this only sets the starting point.
   */
  dense = true,
}: {
  stocks: Stock[];
  selected: string | null;
  onSelect: (t: string) => void;
  rankingKey: HorizonScoreKey;
  dense?: boolean;
}) {
  const prefs = useRef(loadPrefs()).current;
  const defaultPreset = dense ? 'screener' : 'essentials';

  const [sortKey, setSortKey] = useState<keyof Stock>(rankingKey);
  const [desc, setDesc] = useState(true);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('all');
  const [pageSize, setPageSize] = useState(prefs.pageSize ?? DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [compact, setCompact] = useState(prefs.compact ?? false);
  const [preset, setPreset] = useState<string | null>(prefs.preset ?? defaultPreset);
  const [visibleCols, setVisibleCols] = useState<string[]>(prefs.columns ?? presetColumns(defaultPreset));
  const [scrolled, setScrolled] = useState(false);

  const sectors = useMemo(
    () => ['all', ...Array.from(new Set(stocks.map((s) => s.sector).filter(Boolean) as string[])).sort()],
    [stocks],
  );

  const horizon = HORIZONS.find((h) => h.scoreKey === rankingKey) ?? HORIZONS[1];
  const ctx: ColumnContext = useMemo(
    () => ({ rankingKey, horizonLabel: horizon.label }),
    [rankingKey, horizon.label],
  );

  const columns = useMemo(() => orderColumns(visibleCols), [visibleCols]);
  const tableWidth = RANK_WIDTH + columns.reduce((a, c) => a + c.width, 0);

  useEffect(() => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ preset, columns: visibleCols, compact, pageSize } satisfies Persisted),
    );
  }, [preset, visibleCols, compact, pageSize]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = stocks.filter((s) => {
      if (sector !== 'all' && s.sector !== sector) return false;
      if (!q) return true;
      return s.symbol.toLowerCase().includes(q) || (s.name ?? '').toLowerCase().includes(q);
    });
    return [...out].sort((a, b) => {
      if (sortKey === 'symbol') {
        return desc ? b.symbol.localeCompare(a.symbol) : a.symbol.localeCompare(b.symbol);
      }
      const av = (a[sortKey] as number | null) ?? -Infinity;
      const bv = (b[sortKey] as number | null) ?? -Infinity;
      return desc ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
  }, [stocks, query, sector, sortKey, desc]);

  // Any change to the result set invalidates the current page number.
  useEffect(() => setPage(0), [query, sector, sortKey, desc, stocks, pageSize]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const pageRows = useMemo(
    () => rows.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [rows, safePage, pageSize],
  );

  useEffect(() => {
    setSortKey(rankingKey);
    setDesc(true);
  }, [rankingKey]);

  /**
   * Basic/Advanced and the column picker both choose columns, so flipping the mode has to
   * win — otherwise the control would visibly do nothing once someone had customised.
   * Skipped on mount so it never overwrites what was saved last visit.
   */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setPreset(defaultPreset);
    setVisibleCols(presetColumns(defaultPreset));
  }, [defaultPreset]);

  /**
   * Keyboard nav and cross-tab links select by symbol, and paging can put that symbol out
   * of view — pressing j at the bottom of page 1 would otherwise select an invisible row.
   */
  useEffect(() => {
    if (!selected) return;
    const idx = rows.findIndex((s) => s.symbol === selected);
    if (idx < 0) return;
    const target = Math.floor(idx / pageSize);
    if (target !== safePage) setPage(target);
  }, [selected, rows, pageSize, safePage]);

  function toggle(k: keyof Stock) {
    if (k === sortKey) setDesc(!desc);
    else {
      setSortKey(k);
      setDesc(true);
    }
  }

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`market-lab-screen-${stamp}.csv`, toCsv(rows, columns, ctx));
  }

  const rowPad = compact ? 'py-1.5' : 'py-2.5';

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-full flex-1 sm:min-w-52">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol or company…"
            className="h-11 pl-9 text-base sm:h-8 sm:text-sm"
          />
        </div>
        <Select value={sector} onValueChange={setSector}>
          <SelectTrigger aria-label="Filter by sector" className="h-11 flex-1 sm:h-8 sm:max-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sectors.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? 'All sectors' : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-medium text-muted-foreground">
          {rows.length.toLocaleString('en-IN')} match
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:block">
            <ColumnPicker
              visible={visibleCols}
              onChange={(ids) => {
                setVisibleCols(ids);
                setPreset(null);
              }}
              ctx={ctx}
              activePreset={preset}
              onPreset={setPreset}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="hidden h-8 md:inline-flex"
            aria-pressed={compact}
            onClick={() => setCompact(!compact)}
            title={compact ? 'Switch to comfortable rows' : 'Switch to compact rows'}
          >
            {compact ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
            <span className="sr-only">Row height</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-8"
            onClick={exportCsv}
            disabled={!rows.length}
            title="Download every matching row, with the columns you have chosen"
          >
            <Download className="size-4" />
            Export
          </Button>
        </div>

        {dense && (
          <span className="hidden w-full text-xs text-muted-foreground xl:inline">
            <kbd className="rounded border px-1 py-0.5 font-mono text-[10px]">j</kbd>
            <kbd className="ml-1 rounded border px-1 py-0.5 font-mono text-[10px]">k</kbd> move ·{' '}
            <kbd className="rounded border px-1 py-0.5 font-mono text-[10px]">/</kbd> search ·{' '}
            <kbd className="rounded border px-1 py-0.5 font-mono text-[10px]">esc</kbd> close
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <SearchX className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No stocks match these filters</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {query || sector !== 'all'
              ? 'Clear the search or sector here, or widen the filters in the rail.'
              : 'Widen the filters in the rail to bring stocks back.'}
          </p>
          {(query || sector !== 'all') && (
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => {
                setQuery('');
                setSector('all');
              }}
            >
              Clear search and sector
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="divide-y md:hidden">
            {pageRows.map((s, idx) => {
              const i = safePage * pageSize + idx;
              return (
                <Button
                  key={s.symbol}
                  type="button"
                  variant="ghost"
                  onClick={() => onSelect(s.symbol)}
                  className={`h-auto w-full justify-start rounded-none px-4 py-4 text-left ${
                    selected === s.symbol ? 'bg-muted' : ''
                  }`}
                >
                  <div className="w-full">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs tabular-nums text-muted-foreground">#{i + 1}</span>
                          <span className="font-semibold text-foreground">{s.symbol}</span>
                          {s.bucket && <Badge variant="secondary">{BUCKET_LABEL[s.bucket]}</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.name}</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <OwnershipBadge stock={s} />
                          {(s.news_count_14d ?? 0) > 0 && (
                            <Badge variant="outline">{s.news_count_14d} filings</Badge>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`text-2xl font-semibold tabular-nums tracking-[-0.03em] ${scoreColor(s.opportunity_score)}`}>
                          {s.opportunity_score?.toFixed(0) ?? '—'}
                        </div>
                        <div className="text-[11px] text-muted-foreground">research score</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fit {horizon.label}</div>
                        <div className={`mt-0.5 text-base font-semibold tabular-nums ${scoreColor(s[rankingKey])}`}>
                          {s[rankingKey]?.toFixed(0) ?? '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk</div>
                        <div className="mt-0.5 text-base font-semibold text-foreground">{s.risk_level ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Liquidity</div>
                        <div className="mt-0.5 truncate font-medium text-foreground">{formatTurnover(s.turnover_median)}</div>
                      </div>
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>

          <div
            onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
            className="relative hidden max-h-[640px] overflow-auto md:block"
          >
            <Table className="w-full" style={{ minWidth: tableWidth }}>
              <TableHeader className="sticky top-0 z-20 bg-background text-xs text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    className="sticky left-0 z-30 bg-background px-3 py-2 text-left font-normal"
                    style={{ width: RANK_WIDTH, minWidth: RANK_WIDTH }}
                  >
                    #
                  </TableHead>
                  {columns.map((c) => {
                    const key = c.sortKey?.(ctx);
                    const active = key != null && key === sortKey;
                    return (
                      <TableHead
                        key={c.id}
                        title={c.help}
                        style={colStyle(c)}
                        className={`px-3 py-2 font-normal ${c.numeric ? 'text-right' : 'text-left'} ${
                          c.pinned
                            ? `sticky z-30 bg-background ${scrolled ? 'shadow-[1px_0_0_0_var(--border)]' : ''}`
                            : ''
                        }`}
                        aria-sort={active ? (desc ? 'descending' : 'ascending') : key ? 'none' : undefined}
                      >
                        {key ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggle(key)}
                            className={`group h-7 max-w-full px-1 ${c.numeric ? 'ml-auto' : ''} ${
                              active ? 'text-foreground' : ''
                            }`}
                          >
                            <span className="truncate">{c.label(ctx)}</span>
                            {active ? (
                              desc ? <ArrowDown className="size-3 shrink-0" /> : <ArrowUp className="size-3 shrink-0" />
                            ) : (
                              <ChevronsUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-40" />
                            )}
                          </Button>
                        ) : (
                          <span className="px-1">{c.label(ctx)}</span>
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((s, idx) => {
                  const i = safePage * pageSize + idx;
                  const isSelected = selected === s.symbol;
                  // Sticky cells sit above the row, so they need their own opaque background.
                  const rowBg = isSelected ? 'bg-primary/10' : idx % 2 ? 'bg-muted/30' : 'bg-background';
                  return (
                    <TableRow
                      key={s.symbol}
                      onClick={() => onSelect(s.symbol)}
                      aria-selected={isSelected}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary/10 hover:bg-primary/10' : idx % 2 ? 'bg-muted/30' : ''
                      }`}
                    >
                      <TableCell
                        className={`sticky left-0 z-10 px-3 ${rowPad} text-xs tabular-nums text-muted-foreground ${rowBg}`}
                        style={{ width: RANK_WIDTH, minWidth: RANK_WIDTH }}
                      >
                        {i + 1}
                      </TableCell>
                      {columns.map((c) => (
                        <TableCell
                          key={c.id}
                          style={colStyle(c)}
                          className={`px-3 ${rowPad} ${c.numeric ? 'text-right' : ''} ${
                            c.pinned
                              ? `sticky z-10 ${rowBg} ${scrolled ? 'shadow-[1px_0_0_0_var(--border)]' : ''}`
                              : ''
                          }`}
                        >
                          {c.cell(s, ctx)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Pagination
            page={safePage}
            pageSize={pageSize}
            total={rows.length}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </>
      )}
    </Card>
  );
}
