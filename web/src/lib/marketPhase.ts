/**
 * Market phase, computed in the browser from IST wall-clock time.
 *
 * The backend has the same logic, but a static deploy has no backend — and this is pure
 * calendar arithmetic, so there is no reason to spend a network round-trip on it. Doing
 * it client-side also means the phase stays correct for a visitor sitting on the page,
 * instead of freezing at whatever the last build recorded.
 */
export type MarketPhaseInfo = {
  phase: string;
  isOpen: boolean;
  nowIst: Date;
  newDataExpected: string | null;
  /** True on a trading day after the close but before NSE publishes the bhavcopy. */
  awaitingToday: boolean;
};

const OPEN_MIN = 9 * 60 + 15;
const CLOSE_MIN = 15 * 60 + 30;
/** NSE publishes the day's bhavcopy well after the close; nothing is new before this. */
const BHAVCOPY_READY_MIN = 18 * 60 + 30;

/** Current time as it would read on a clock in India, regardless of device timezone. */
export function nowInIst(now: Date = new Date()): Date {
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

export function marketPhase(now: Date = new Date()): MarketPhaseInfo {
  const ist = nowInIst(now);
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const weekday = ist.getDay();
  const weekend = weekday === 0 || weekday === 6;

  let phase: string;
  if (weekend) phase = 'weekend';
  else if (minutes < OPEN_MIN) phase = 'pre-open';
  else if (minutes <= CLOSE_MIN) phase = 'open';
  else if (minutes < BHAVCOPY_READY_MIN) phase = 'closed - awaiting bhavcopy';
  else phase = 'closed';

  return {
    phase,
    isOpen: phase === 'open',
    nowIst: ist,
    newDataExpected: weekend ? null : '18:30 IST',
    // Between the close and the bhavcopy there is genuinely no official figure for today
    // anywhere, so the board showing yesterday is correct rather than stale.
    awaitingToday: !weekend && minutes < BHAVCOPY_READY_MIN,
  };
}
