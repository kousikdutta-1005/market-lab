import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Pagination for large result sets.
 *
 * "Show more" is fine for a feed and wrong for a screener: it gives no sense of how much
 * is left, cannot be returned to, and quietly grows the DOM until scrolling stutters —
 * which it did at 1,600 rows. Explicit pages keep the rendered set bounded and let someone
 * say "the 4th page of my screen" and mean it.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2.5">
      <span className="t-body text-muted-foreground">
        {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
      </span>

      <div className="flex items-center gap-1.5">
        <span className="t-meta text-muted-foreground">Rows</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger aria-label="Rows per page" size="sm" className="w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, 100, 250].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPage(0)}
          disabled={page === 0}
          aria-label="First page"
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2 t-body tabular-nums text-foreground">
          {page + 1} / {pages}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages - 1}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPage(pages - 1)}
          disabled={page >= pages - 1}
          aria-label="Last page"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
