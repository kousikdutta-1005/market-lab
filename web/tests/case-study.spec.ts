import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const BASE = process.env.ML_BASE ?? 'http://127.0.0.1:5177';
const OUTPUT = process.env.ML_SCREENSHOT_DIR ?? 'test-results/case-study';

const richStocks = ['RELIANCE', 'TCS', 'HDFCBANK'].map((symbol, index) => ({
  symbol,
  name: {
    RELIANCE: 'Reliance Industries Limited',
    TCS: 'Tata Consultancy Services Limited',
    HDFCBANK: 'HDFC Bank Limited',
  }[symbol],
  sector: index === 0 ? 'Energy' : index === 1 ? 'Information Technology' : 'Financial Services',
  bucket: 'large',
  rating_basis: 'fundamental + technical',
  best_horizon: index === 0 ? 'medium' : 'long',
  medium_fit: 90 - index * 4,
  long_fit: 86 - index * 2,
  opportunity_score: 92 - index * 3,
  composite: 84 - index * 4,
  coverage: 0.96,
  pillars_used: 5,
  risk_level: index === 2 ? 'Watch' : 'Low',
  risk_score: 84 - index * 5,
  turnover_median: 8_000_000_000 - index * 1_000_000_000,
  price: 1400 + index * 700,
  market_cap: 8_000_000_000_000 - index * 500_000_000_000,
  quality: 88 - index * 4,
  growth: 79 - index * 2,
  valuation: 51 + index * 5,
  trend: 82 - index * 3,
  momentum: 76 - index * 3,
  roe: 0.19 + index * 0.02,
  revenue_cagr: 0.14 - index * 0.01,
  pe: 24 + index * 2,
  above_200dma: 8 - index,
  ret_12m: 0.18 - index * 0.02,
  delivery_pct_latest: 54 + index * 3,
}));

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: '2026-08-14T13:45:00Z',
    last_trading_session: '2026-08-14',
    sessions: 504,
    universe_total: 2078,
    tradeable: 1801,
    scoreable: 1606,
    scored: 1602,
    rated_full: 1550,
    rated_technical: 52,
    source: 'NSE published files',
    elapsed_s: 58,
    weights: {},
    metrics: {},
    horizon_weights: {},
    market_regime: 'constructive, mixed breadth',
    market_regime_summary: 'Large caps remain firm while participation is narrower below the index.',
    breadth_advance_pct: 54,
    above_50dma_pct: 61,
    breadth_advancers: 868,
    breadth_decliners: 734,
    deal_symbols: 18,
    delivery_symbols: 1560,
    high_risk_symbols: 47,
    fo_ban_count: 2,
    stocks: richStocks,
    excluded: [],
    ...overrides,
  };
}

async function routeScreen(page: Page, payload: unknown) {
  await page.route('**/data/screen.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }),
  );
}

test.beforeAll(() => mkdirSync(OUTPUT, { recursive: true }));

for (const theme of ['light', 'dark'] as const) {
  test(`captures recoverable data error in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((choice) => localStorage.setItem('ml-theme', choice), theme);
    await page.route('**/data/screen.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.route('**/api/screen', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(BASE);
    await expect(page.getByRole('heading', { name: 'Market data did not load' })).toBeVisible();
    await page.screenshot({ path: join(OUTPUT, `recoverable-data-error-${theme}.png`) });
  });
}

for (const { theme, width } of [{ theme: 'light', width: 390 }, { theme: 'dark', width: 320 }] as const) {
  test(`captures intentional ${width}px mobile ranking in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((choice) => localStorage.setItem('ml-theme', choice), theme);
    await routeScreen(page, fixture());
    await page.setViewportSize({ width, height: 844 });
    await page.goto(BASE);
    const ranking = page.locator('section', { hasText: 'Highest ranked on this screen' }).first();
    await expect(ranking.getByText('RELIANCE', { exact: true })).toBeVisible();
    await ranking.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY - 68;
      window.scrollTo({ top, behavior: 'auto' });
    });
    await page.screenshot({ path: join(OUTPUT, `mobile-ranking-${width}-${theme}.png`) });
  });
}
