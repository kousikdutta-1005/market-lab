import { cn } from '@/lib/utils';

/**
 * A view switcher.
 *
 * Deliberately *not* Radix Tabs. Tabs emit `aria-controls` pointing at a TabsContent
 * panel; using them purely as a styled switcher while rendering the content elsewhere
 * leaves that attribute referencing an element that does not exist, which axe-core flags
 * as a critical `aria-valid-attr-value` failure and which genuinely breaks screen-reader
 * navigation.
 *
 * A group of buttons with `aria-pressed` says exactly what this control is: a set of
 * toggles where one is active.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  items,
  label,
  size = 'default',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string }>;
  /** Names the group for assistive tech, e.g. "Time horizon". */
  label: string;
  size?: 'default' | 'sm';
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex w-full items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
    >
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex-1 rounded-md px-2.5 font-medium whitespace-nowrap transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              size === 'sm' ? 'py-1 text-xs' : 'py-1.5 text-sm',
              active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
