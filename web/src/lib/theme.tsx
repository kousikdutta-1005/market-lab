import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Theme handling.
 *
 * Three states rather than two: most people never touch a theme switch, so "System" has
 * to be a real, persistent option that keeps following the OS — including when the OS
 * flips at sunset while the tab is open. A boolean toggle silently overrides that the
 * first time it is clicked and can never return.
 *
 * The applied class is set on <html> before paint (see index.html) so a dark-mode user
 * never gets a white flash on load.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE = 'ml-theme';

type Ctx = { choice: ThemeChoice; resolved: 'light' | 'dark'; setChoice: (c: ThemeChoice) => void };
const ThemeContext = createContext<Ctx | null>(null);

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStored(): ThemeChoice {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    // Lets the browser paint native form controls and scrollbars to match.
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    localStorage.setItem(STORAGE, c);
  }, []);

  const value = useMemo(() => ({ choice, resolved, setChoice }), [choice, resolved, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
