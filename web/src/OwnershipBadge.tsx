import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Stock } from './types';

/**
 * Large-holder activity, condensed to a single glanceable badge.
 *
 * A SAST filing is one of the few genuinely high-signal disclosures retail investors can
 * see — someone crossing 5%, or a promoter changing their own stake, had to tell the
 * exchange. Leaving it inside a sub-pane meant it only reached people already digging.
 * Promoter direction is called out separately from third-party activity because the two
 * carry very different weight.
 */
export function ownershipSignal(stock: Stock) {
  const events = stock.sast_events_180d ?? 0;
  if (!events) return null;
  if (stock.sast_promoter_buying && !stock.sast_promoter_selling) {
    return { tone: 'success' as const, label: 'Promoter buying', events };
  }
  if (stock.sast_promoter_selling && !stock.sast_promoter_buying) {
    return { tone: 'warning' as const, label: 'Promoter selling', events };
  }
  const net = stock.sast_net_shares ?? 0;
  if (net > 0) return { tone: 'success' as const, label: 'Large holders buying', events };
  if (net < 0) return { tone: 'warning' as const, label: 'Large holders selling', events };
  return { tone: 'neutral' as const, label: 'Large-holder filing', events };
}

export function OwnershipBadge({ stock, compact = false }: { stock: Stock; compact?: boolean }) {
  const signal = ownershipSignal(stock);
  if (!signal) return null;

  const tone =
    signal.tone === 'success'
      ? 'border-success/30 bg-success-subtle text-success'
      : signal.tone === 'warning'
        ? 'border-warning/30 bg-warning-subtle text-warning'
        : '';

  return (
    <Badge
      variant="outline"
      className={tone}
      title={`${signal.events} SEBI SAST filing${signal.events === 1 ? '' : 's'} in the last 180 days${
        stock.sast_latest_holder ? ` · latest: ${stock.sast_latest_holder}` : ''
      }`}
    >
      <Users className="size-3" />
      {compact ? `${signal.events}` : signal.label}
    </Badge>
  );
}
