import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search, TriangleAlert } from 'lucide-react';
import { PILLARS, scoreBg, scoreColor, type Pillar, type Stock } from './types';

type SortKey = 'composite' | Pillar | 'ticker';

function Bar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-600">—</span>;
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

  const sectors = useMemo(
    () => ['all', ...Array.from(new Set(stocks.map((s) => s.sector).filter(Boolean) as string[])).sort()],
    [stocks],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = stocks.filter((s) => {
      if (sector !== 'all' && s.sector !== sector) return false;
      if (!q) return true;
      return s.ticker.toLowerCase().includes(q) || (s.name ?? '').toLowerCase().includes(q);
    });
    out = [...out].sort((a, b) => {
      if (sortKey === 'ticker') return desc ? b.ticker.localeCompare(a.ticker) : a.ticker.localeCompare(b.ticker);
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return desc ? bv - av : av - bv;
    });
    return out;
  }, [stocks, query, sector, sortKey, desc]);

  function toggle(k: SortKey) {
    if (k === sortKey) setDesc(!desc);
    else {
      setSortKey(k);
      setDesc(true);
    }
  }

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-medium">
      <button onClick={() => toggle(k)} className="flex items-center gap-1 hover:text-slate-200">
        {children}
        {sortKey === k &&
          (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 p-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or company…"
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
        <span className="text-sm text-slate-500">{rows.length} shown</span>
      </div>

      <div className="max-h-[560px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <Th k="ticker">Stock</Th>
              <Th k="composite">Composite</Th>
              {PILLARS.map((p) => (
                <Th key={p} k={p}>
                  {p}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr
                key={s.ticker}
                onClick={() => onSelect(s.ticker)}
                className={`cursor-pointer border-t border-slate-800/60 transition-colors ${
                  selected === s.ticker ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                }`}
              >
                <td className="px-3 py-2 text-xs tabular-nums text-slate-600">{i + 1}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="font-medium text-slate-200">{s.ticker}</div>
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
                {PILLARS.map((p) => (
                  <td key={p} className="px-3 py-2">
                    <Bar value={s[p]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
