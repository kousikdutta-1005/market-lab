import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A labelled layer of detail that is closed until asked for.
 *
 * The board carries a lot of genuinely useful material — methodology, source health,
 * exclusion reasons, risk controls. Showing all of it at once buries the one thing a
 * visitor actually came for, but hiding it would make the tool unauditable, which is the
 * whole point of it. So it lives exactly one click away, with a summary line that says
 * what is inside, and it stays open once opened.
 */
export function Disclosure({
  title,
  summary,
  icon,
  children,
  defaultOpen = false,
  tone = 'default',
}: {
  title: string;
  summary?: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: 'default' | 'accent';
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={cn('overflow-hidden py-0', tone === 'accent' && 'border-primary/20 bg-primary/5')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {summary && <span className="mt-0.5 block text-[13px] text-muted-foreground">{summary}</span>}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="border-t px-4 py-4">{children}</div>}
    </Card>
  );
}
