import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A single notice component.
 *
 * The same amber-bordered box had been hand-rolled in a dozen places with slightly
 * different padding, border weights and text colours, so warnings that meant the same
 * thing looked like different things. One component means one appearance, and it moves
 * with the theme instead of being pinned to a hardcoded palette.
 */
export function Callout({
  tone = 'info',
  title,
  icon,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: { box: 'border-border bg-muted/50 text-foreground', mark: 'text-muted-foreground', Icon: Info },
    warning: { box: 'border-warning/30 bg-warning-subtle text-foreground', mark: 'text-warning', Icon: AlertTriangle },
    danger: { box: 'border-danger/30 bg-danger-subtle text-foreground', mark: 'text-danger', Icon: AlertTriangle },
    success: { box: 'border-success/30 bg-success-subtle text-foreground', mark: 'text-success', Icon: CheckCircle2 },
  } as const;
  const { box, mark, Icon } = tones[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : tone === 'warning' ? 'status' : undefined}
      className={cn('flex items-start gap-2 rounded-lg border p-3 t-body', box, className)}
    >
      <span className={cn('mt-0.5 shrink-0', mark)}>{icon ?? <Icon className="size-4" />}</span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-1', 'text-muted-foreground')}>{children}</div>}
      </div>
    </div>
  );
}
