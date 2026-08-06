import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search, TriangleAlert, LineChart } from 'lucide-react';
import {
  PILLARS, scoreBg, scoreColor, formatTurnover, BUCKET_LABEL,
  type Pillar, type Stock,
} from './types';

type SortKey = 'composite' | Pillar | 'symbol' | 'turnover_median';

/** 1,600 rows in the DOM makes every 5s re-render janky. Render a page at a time. */
const PAGE = 100;

function Bar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-slate-600">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-700/60">
        <div className={`h-full rounded-full ${scoreBg(value)}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-7 text-right text-xs tabular-nums text-slate-400">{value.toFixed(0)}</span>
    </div>
  );
}

export function StockTable({
  stocks,
  selected,
  onSelect,
}: {
  stocks: Stock[];
  selected: string | null;
  onSelect: (t: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('composite');
  const [desc, setDesc] = useState(true);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('all');
  const [limit, setLimit] = useState(PAGE);

  const sectors = useMemo(
    () => ['all', ...Array.from(new Set(stocks.map((s) => s.sector).filter(Boolean) as string[])).sort()],
    [stocks],
  );

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
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return desc ? bv - av : av - bv;
    });
  }, [stocks, query, sector, sortKey, desc]);

  useEffect(() => setLimit(PAGE), [query, sector, sortKey, desc, stocks]);

  function toggle(k: SortKey) {
    if (k === sortKey) setDesc(!desc);
    else {
      setSortKey(k);
      setDesc(true);
    }
  }

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => toggle(k)}
        className={`flex items-center gap-1 hover:text-slate-200 ${right ? 'ml-auto' : ''}`}
      >
        {children}
        {sortKey === k && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol or company…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/60 py-2 pl-9 pr-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-500"
          />
        </div>
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300 outline-none focus:border-slate-500"
        >
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All sectors' : s}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500">
          {rows.length.toLocaleString('en-IN')} match
        </span>
      </div>

      <div className="max-h-[620px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <Th k="symbol">Stock</Th>
              <Th k="composite">Composite</Th>
              <Th k="turnover_median" right>
                Liquidity
              </Th>
              {PILLARS.map((p) => (
                <Th key={p} k={p}>
                  {p}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((s, i) => {
              const techOnly = s.rating_basis === 'technical only';
              return (
                <tr
                  key={s.symbol}
                  onClick={() => onSelect(s.symbol)}
                  className={`cursor-pointer border-t border-slate-800/60 transition-colors ${
                    selected === s.symbol ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                  }`}
                >
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-600">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-200">{s.symbol}</span>
                          {s.bucket && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                              {BUCKET_LABEL[s.bucket]}
                            </span>
                          )}
                          {techOnly && (
                            <span
                              title="Scored on price behaviour only — no financial statements were available for this company."
                              className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-500/90"
                            >
                              <LineChart className="size-2.5" />
                              tech
                            </span>
                          )}
                        </div>
                        <div className="max-w-52 truncate text-xs text-slate-500">{s.name}</div>
                      </div>
                      {s.data_flags ? (
                        <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-base font-semibold tabular-nums ${scoreColor(s.composite)}`}>
                      {s.composite?.toFixed(0) ?? '—'}
                    </span>
                  </td>
                  <td
                    className="px-3 py-2 text-right text-xs tabular-nums text-slate-400"
                    title="Median daily traded value over the last year, as reported by NSE."
                  >
                    {formatTurnover(s.turnover_median)}
                  </td>
                  {PILLARS.map((p) => (
                    <td key={p} className="px-3 py-2">
                      <Bar value={s[p]} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {limit < rows.length && (
          <button
            onClick={() => setLimit((l) => l + PAGE * 4)}
            className="w-full border-t border-slate-800 py-3 text-sm text-slate-400 transition hover:bg-slate-800/40 hover:text-slate-200"
          >
            Show more — {(rows.length - limit).toLocaleString('en-IN')} remaining
          </button>
        )}
      </div>
    </div>
  );
}
