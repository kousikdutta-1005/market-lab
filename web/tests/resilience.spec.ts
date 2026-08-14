import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const BASE = process.env.ML_BASE ?? 'http://127.0.0.1:5177';

function stock(symbol: string, overrides: Record<string, unknown> = {}) {
  return {
    symbol,
    name: `${symbol} Limited`,
    sector: 'Industrials',
    bucket: 'large',
    rating_basis: 'fundamental + technical',
    best_horizon: 'medium',
    medium_fit: 76,
    opportunity_score: 84,
    composite: 72,
    coverage: 1,
    pillars_used: 5,
    risk_level: 'Low',
    risk_score: 82,
    turnover_median: 500_000_000,
    price: 100,
    pe: 20,
    ...overrides,
  };
}

function screen(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: '2026-08-14T13:45:00Z',
    last_trading_session: '2026-08-14',
    sessions: 504,
    universe_total: 2,
    tradeable: 2,
    scoreable: 2,
    scored: 2,
    rated_full: 2,
    rated_technical: 0,
    source: 'Test fixture',
    elapsed_s: 1,
    weights: {},
    metrics: {},
    horizon_weights: {},
    stocks: [stock('ALPHA'), stock('BETA', { medium_fit: 64, opportunity_score: 70 })],
    excluded: [],
    ...overrides,
  };
}

async function mockScreen(page: Page, payload: unknown) {
  await page.route('**/data/screen.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }),
  );
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw new Error(`Uncaught page error: ${error.message}`);
  });
});

test('failed data load is distinct from loading and can recover without reloading the app', async ({ page }) => {
  let recover = false;
  const respond = (route: Route) => {
    if (!recover) return route.fulfill({ status: 503, body: 'unavailable' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(screen()) });
  };
  await page.route('**/data/screen.json', respond);
  await page.route('**/api/screen', respond);

  await page.goto(BASE);
  await expect(page.getByRole('heading', { name: 'Market data did not load' })).toBeVisible();
  await expect(page.getByText(/No scores are shown without their source data/)).toBeVisible();
  recover = true;
  await page.getByRole('button', { name: 'Retry data' }).click();
  await expect(page.getByRole('heading', { name: 'market-lab' })).toBeVisible();
});

test('malformed, duplicate, and context-free rows are visible as degraded data, never ranked success', async ({ page }) => {
  await mockScreen(page, screen({
    generated_at: 'not-a-date',
    last_trading_session: '',
    stocks: [
      stock('ALPHA'),
      stock('ALPHA', { opportunity_score: 99 }),
      stock('NOCTX', { risk_level: null, turnover_median: null, best_horizon: null, opportunity_score: 98 }),
      { name: 'Missing symbol' },
    ],
  }));

  await page.goto(BASE);
  const warning = page.getByText('This build has incomplete data');
  await expect(warning).toBeVisible();
  await expect(page.getByText(/duplicate ticker row/)).toBeVisible();
  await expect(page.getByText(/research scores were suppressed/)).toBeVisible();
  const ranking = page.locator('section', { hasText: 'Highest ranked on this screen' }).first();
  await expect(ranking.getByText('NOCTX', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Screener' }).first().click();
  await page.getByPlaceholder('Search symbol or company…').fill('NOCTX');
  const row = page.locator('tbody tr').filter({ hasText: 'NOCTX' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('—');
});

test('empty ranked results explain the active boundary and reset all filters', async ({ page }) => {
  await mockScreen(page, screen());
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();

  await page.getByRole('combobox', { name: 'Minimum fit' }).click();
  await page.getByRole('option', { name: '90+' }).click();
  await expect(page.getByText('No stocks match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Reset all filters' }).click();
  await expect(page.locator('tbody tr').filter({ hasText: 'ALPHA' })).toBeVisible();
});

test('custom formulas support string comparisons and fail closed without hiding rows', async ({ page }) => {
  await mockScreen(page, screen());
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
  await page.getByRole('button', { name: /More filters/ }).click();
  const formula = page.getByLabel('Custom formula');
  await formula.fill("bucket === 'large' and pe > 0");
  await expect(page.locator('tbody tr')).toHaveCount(2);

  await formula.fill('pe > 0 ? foo() : true');
  await expect(page.getByText(/formula is not valid yet/)).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('a background data recheck preserves assistant drafts and transient UI state', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ml-ai-config', JSON.stringify({
      provider: 'compatible',
      apiKey: '',
      model: 'local',
      baseUrl: 'http://127.0.0.1:9/v1',
    }));
  });
  let delayNext = false;
  await page.route('**/data/screen.json', async (route) => {
    if (delayNext) await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(screen({ generated_at: '2020-01-01T00:00:00Z' })),
    });
  });
  await page.route('**/api/status', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto(BASE);
  const recheck = page.getByRole('button', { name: 'Recheck published data' });
  await expect(recheck).toBeVisible({ timeout: 10000 });
  delayNext = true;
  await recheck.click();
  await page.getByRole('button', { name: 'AI assistant' }).click();
  const input = page.getByLabel('Question for the AI assistant');
  await input.fill('Compare ALPHA and BETA');
  await page.waitForTimeout(1000);
  await expect(input).toHaveValue('Compare ALPHA and BETA');
});

test('failed background recheck keeps the last known screen and offers retry', async ({ page }) => {
  let fail = false;
  await page.route('**/data/screen.json', (route) =>
    fail
      ? route.fulfill({ status: 503, body: 'unavailable' })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(screen({ generated_at: '2020-01-01T00:00:00Z' })),
        }),
  );
  await page.route('**/api/screen', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.route('**/api/status', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto(BASE);
  const recheck = page.getByRole('button', { name: 'Recheck published data' });
  await expect(recheck).toBeVisible({ timeout: 10000 });
  fail = true;
  await recheck.click();
  await expect(page.getByText('Showing the last data already on this page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'market-lab' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry refresh' })).toBeVisible();
});

test('malformed columnar rows are counted in the visible quality warning', async ({ page }) => {
  const payload = {
    format: 'columnar-v1',
    meta: screen({ stocks: undefined, excluded: undefined }),
    stocks: {
      columns: Object.keys(stock('ALPHA')),
      rows: [Object.values(stock('ALPHA')), { malformed: true }],
    },
    excluded: { columns: ['symbol'], rows: [] },
  };
  await mockScreen(page, payload);
  await page.goto(BASE);
  await expect(page.getByText(/1 malformed row was excluded/)).toBeVisible();
  await expect(page.getByText('ALPHA', { exact: true }).first()).toBeVisible();
});

test('desktop stock rows open from the keyboard and restore a clear close target', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockScreen(page, screen());
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
  const row = page.locator('tbody tr').nth(1);
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close factsheet' })).toBeVisible();
  await expect(page.locator('aside').getByRole('heading').first()).toHaveText('BETA');
  await page.getByRole('button', { name: 'Close factsheet' }).click();
  await expect(page.locator('aside')).toHaveCount(0);
});

test('portfolio rejects invalid and unknown inputs, and updates duplicates explicitly', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ml-portfolio', '{damaged'));
  await mockScreen(page, screen());
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Portfolio' }).first().click();

  await expect(page.getByText('Portfolio storage needs attention')).toBeVisible();
  await page.getByPlaceholder('RELIANCE').fill('ALPHA');
  await page.getByPlaceholder('100').fill('0');
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByText('Quantity must be a number greater than zero.')).toBeVisible();

  await page.getByPlaceholder('100').fill('10');
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByText('1 holding')).toBeVisible();
  await page.getByPlaceholder('RELIANCE').fill('ALPHA');
  await page.getByPlaceholder('100').fill('12');
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByText(/already existed.*updated/)).toBeVisible();

  await page.getByPlaceholder('RELIANCE').fill('UNKNOWN');
  await page.getByPlaceholder('100').fill('2');
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByText(/is not in the current scored universe/)).toBeVisible();
});

test('portfolio stays usable when browser storage quota is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ml-portfolio') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await mockScreen(page, screen());
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Portfolio' }).first().click();
  await expect(page.getByText(/could not be saved in this browser/)).toBeVisible();
  await expect(page.getByText(/Add your holdings/)).toBeVisible();
});

test('portfolio distinguishes unavailable price history from insufficient history and offers retry', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ml-portfolio', JSON.stringify([
    { symbol: 'ALPHA', qty: 10, avgPrice: 90 },
    { symbol: 'BETA', qty: 5, avgPrice: 80 },
  ])));
  await mockScreen(page, screen());
  await page.route('**/data/calendar.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.route('**/data/charts/**', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.route('**/api/chart/**', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Portfolio' }).first().click();
  await expect(page.getByText(/Price histories could not be loaded/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('unsupported assistant requests are refused locally without contacting a provider', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ml-ai-config', JSON.stringify({
      provider: 'compatible',
      apiKey: '',
      model: 'local',
      baseUrl: 'http://127.0.0.1:9/v1',
    }));
  });
  await mockScreen(page, screen());
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(':9/v1')) providerRequests.push(request.url());
  });

  await page.goto(BASE);
  await page.getByRole('button', { name: 'AI assistant' }).click();
  await page.getByLabel('Question for the AI assistant').fill('Which stock should I buy?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText(/outside this tool’s boundary/)).toBeVisible();
  await page.getByLabel('Question for the AI assistant').fill('Recommend a stock to purchase');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText(/outside this tool’s boundary/)).toHaveCount(2);
  expect(providerRequests).toEqual([]);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});

for (const width of [320, 430]) {
  test(`recoverable states do not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockScreen(page, screen({ generated_at: '', last_trading_session: '' }));
    await page.goto(BASE);
    await expect(page.getByText('This build has incomplete data')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const navTarget = await page.locator('nav[aria-label="Sections"]').last().getByRole('button').first().boundingBox();
    expect(navTarget?.height).toBeGreaterThanOrEqual(44);
  });
}

test('layout reflows without horizontal page scroll at a 200% equivalent viewport', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await mockScreen(page, screen());
  await page.goto(BASE);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

for (const theme of ['light', 'dark'] as const) {
  test(`recoverable data error has no automated WCAG A/AA violations in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((choice) => localStorage.setItem('ml-theme', choice), theme);
    await page.route('**/data/screen.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.route('**/api/screen', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.goto(BASE);
    await expect(page.getByRole('heading', { name: 'Market data did not load' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`degraded mobile state has no automated WCAG A/AA violations in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((choice) => localStorage.setItem('ml-theme', choice), theme);
    await page.setViewportSize({ width: 320, height: 800 });
    await mockScreen(page, screen({ generated_at: '', last_trading_session: '' }));
    await page.goto(BASE);
    await expect(page.getByText('This build has incomplete data')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  test(`filtered empty state has no automated WCAG A/AA violations in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((choice) => localStorage.setItem('ml-theme', choice), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScreen(page, screen());
    await page.goto(BASE);
    await page.locator('nav[aria-label="Sections"]').last().getByRole('button', { name: 'Screen' }).click();
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('combobox', { name: 'Minimum fit' }).click();
    await page.getByRole('option', { name: '90+' }).click();
    await expect(page.getByText('No stocks match these filters')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
}
