import { useEffect } from 'react';

/**
 * Keyboard navigation for the board.
 *
 * An analyst working a screen for an hour does not want to move a mouse a thousand
 * times. j/k to walk the list, Enter to open, Escape to close, / to jump to search —
 * the same bindings every terminal-style tool has used for decades, so there is nothing
 * to learn.
 *
 * Bindings are suppressed while typing so they never eat characters in an input.
 */
export function useKeyboardNav({
  symbols,
  selected,
  onSelect,
  onClose,
  enabled = true,
}: {
  symbols: string[];
  selected: string | null;
  onSelect: (symbol: string) => void;
  onClose: () => void;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);

      if (e.key === '/' && !typing) {
        e.preventDefault();
        const search = document.querySelector<HTMLInputElement>('input[placeholder^="Search symbol"]');
        search?.focus();
        search?.select();
        return;
      }

      if (e.key === 'Escape') {
        if (typing) (el as HTMLInputElement).blur();
        else onClose();
        return;
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!symbols.length) return;

      const idx = selected ? symbols.indexOf(selected) : -1;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        onSelect(symbols[Math.min(idx + 1, symbols.length - 1)] ?? symbols[0]);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx > 0) onSelect(symbols[idx - 1]);
      } else if (e.key === 'Enter' && idx === -1) {
        e.preventDefault();
        onSelect(symbols[0]);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [symbols, selected, onSelect, onClose, enabled]);
}
