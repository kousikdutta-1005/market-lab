import { Briefcase, Filter, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Primary navigation.
 *
 * Two presentations of one control, because the ergonomics genuinely differ:
 * on a desktop the pointer is already near the header, so a compact pill group there is
 * both tidy and out of the way. On a phone the top of the screen is the hardest place to
 * reach one-handed, so navigation moves to a bottom bar — the pattern every native app
 * uses, sized to the 44px touch target Apple and Google both specify.
 */
export type TabKey = 'discover' | 'screen' | 'investors' | 'portfolio' | 'trust';

export const TABS: { key: TabKey; label: string; short: string; icon: typeof TrendingUp }[] = [
  { key: 'discover', label: 'Top Stocks', short: 'Top', icon: TrendingUp },
  { key: 'screen', label: 'Screener', short: 'Screen', icon: Filter },
  { key: 'investors', label: 'Investors', short: 'Investors', icon: Users },
  { key: 'portfolio', label: 'Portfolio', short: 'Portfolio', icon: Briefcase },
  { key: 'trust', label: 'Methodology', short: 'Method', icon: ShieldCheck },
];

export function DesktopNav({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <nav className="hidden items-center gap-1 rounded-full border bg-muted/50 p-1 md:flex" aria-label="Sections">
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

export function MobileNav({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Sections"
    >
      <div className="grid grid-cols-5">
        {TABS.map(({ key, short, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[56px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('size-5', active && 'stroke-[2.5]')} />
              {short}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
