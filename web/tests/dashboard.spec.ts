import { expect, test } from '@playwright/test';

const BASE = process.env.ML_BASE ?? 'http://127.0.0.1:8787';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw new Error(`Uncaught page error: ${e.message}`);
  });
});

test('dashboard loads with data and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(BASE);
  await expect(page.getByRole('heading', { name: 'market-lab' })).toBeVisible();

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15000 });
  expect(await rows.count()).toBeGreaterThan(50);

  expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('source panel reports every data source reachable', async ({ page }) => {
  await page.goto(BASE);
  const panel = page.locator('section', { hasText: 'Data sources' }).first();
  await expect(panel).toBeVisible();

  const badge = panel.getByText(/\d+ of \d+ reachable/);
  await expect(badge).toBeVisible({ timeout: 30000 });
  const [up, total] = (await badge.innerText()).match(/(\d+) of (\d+)/)!.slice(1).map(Number);
  expect(up).toBe(total);

  for (const name of ['NSE bhavcopy', 'NSE index lists', 'NSE equity list']) {
    await expect(panel.getByText(name, { exact: true })).toBeVisible();
  }
});

test('caveats are shown before any score', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByText('Read this before using any number below')).toBeVisible();
  await expect(page.getByText(/Survivorship bias inflated our own backtest/)).toBeVisible();
  await expect(page.getByText(/not SEBI-registered/i).first()).toBeVisible();
});

test('selecting a stock opens an auditable breakdown', async ({ page }) => {
  await page.goto(BASE);
  await page.getByPlaceholder('Search symbol or company').fill('RELIANCE');
  await page.locator('tbody tr').first().click();

  const detail = page.locator('aside');
  await expect(detail).toBeVisible();
  for (const section of [
    'Company facts',
    'Valuation',
    'Profitability and growth',
    'Returns and technicals',
    'Liquidity and position size',
    'Scorecard',
  ]) {
    await expect(detail.getByRole('heading', { name: section })).toBeVisible();
  }
  await expect(detail.getByText('Return on equity', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(/not what the share price will do next/).first()).toBeVisible();
});

test('search and sort work', async ({ page }) => {
  await page.goto(BASE);
  const search = page.getByPlaceholder('Search symbol or company');
  // Whole-market: "RELIANCE" also matches Reliance Infrastructure, Power etc.
  await search.fill('RELIANCE');
  const hits = page.locator('tbody tr');
  expect(await hits.count()).toBeGreaterThan(0);
  for (const row of await hits.all()) {
    await expect(row).toContainText(/reliance/i);
  }
  await expect(hits.filter({ hasText: 'Reliance Industries Limited' })).toHaveCount(1);

  await search.fill('');
  await page.getByRole('button', { name: /^quality/i }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('data quality flags surface in the UI', async ({ page }) => {
  await page.goto(BASE);
  await page.getByPlaceholder('Search symbol or company').fill('IDEA');
  await page.locator('tbody tr').first().click();

  const detail = page.locator('aside');
  await expect(detail.getByText('Data quality flags')).toBeVisible();
  await expect(detail.getByText('negative_equity')).toBeVisible();
});

test('refresh button runs the pipeline and the board reflects it', async ({ page }) => {
  await page.goto(BASE);

  const before = await page.getByText(/Data from session/).innerText();
  const btn = page.getByRole('button', { name: /Refresh data/i });
  await expect(btn).toBeEnabled();
  await btn.click();

  // Must actually enter a running state, not just look clickable.
  await expect(page.getByRole('button', { name: /Refreshing/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /^Refresh data/i })).toBeVisible({ timeout: 180000 });
  await expect(page.getByText('Refresh complete')).toBeVisible();

  // Age resets, proving the board re-read the freshly written file.
  await expect(page.getByText(/Data from session/)).not.toHaveText(before, { timeout: 15000 });
});

test('board polls on its own without a reload', async ({ page }) => {
  const calls: number[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/status')) calls.push(Date.now());
  });

  await page.goto(BASE);
  await expect(page.getByText(/Market (open|closed|pre-open|post-close)/i)).toBeVisible();

  const start = calls.length;
  await page.waitForTimeout(11000);
  // 5s interval => at least 2 more polls in 11s.
  expect(calls.length - start).toBeGreaterThanOrEqual(2);
});

test('technical-only scores are visibly distinct from fundamental ones', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'technical only' }).click();

  // When fundamentals cover the whole market there is nothing to show here. That is a
  // good state, not a passing test — assert the empty case explicitly so this cannot
  // silently turn into a test that checks nothing.
  const rows = page.locator('tbody tr');
  const n = await rows.count();
  if (n === 0) {
    await expect(page.getByText(/^0 shown$/)).toBeVisible();
    return;
  }

  const first = rows.first();
  await expect(first.getByText('tech', { exact: true })).toBeVisible();

  await first.click();
  const detail = page.locator('aside');
  await expect(detail.getByText('Technical only — no fundamentals')).toBeVisible();
  await expect(detail.getByText(/nothing here reflects profitability, debt or valuation/)).toBeVisible();
});

test('size filters restrict the table', async ({ page }) => {
  await page.goto(BASE);
  const shown = page.getByText(/^[\d,]+ shown$/);
  const all = Number((await shown.innerText()).replace(/[^\d]/g, ''));

  // Turn everything off except Large.
  for (const b of ['Mid', 'Small', 'Micro', 'Nano']) {
    await page.getByRole('button', { name: new RegExp(`^${b} \\d`) }).click();
  }
  const large = Number((await shown.innerText()).replace(/[^\d]/g, ''));
  expect(large).toBeLessThan(all);
  expect(large).toBeGreaterThan(0);
});

test('excluded stocks are disclosed with reasons', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: /stocks excluded from scoring/ }).click();
  const row = page.locator('section', { hasText: 'excluded from scoring' }).locator('tbody tr').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(/turnover|history|price|zero|stale/i);
});

test('horizon research-fit filters rank the board', async ({ page }) => {
  await page.goto(BASE);
  const panel = page.locator('section', { hasText: 'Research fit, not a recommendation' });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit 6-12m' })).toBeVisible();

  const shown = page.getByText(/^[\d,]+ shown$/);
  const before = Number((await shown.innerText()).replace(/[^\d]/g, ''));

  await panel.getByRole('button', { name: '3-5y' }).click();
  await expect(page.getByRole('button', { name: 'Fit 3-5y' })).toBeVisible();

  await panel.locator('select').nth(0).selectOption('90');
  const afterMin = Number((await shown.innerText()).replace(/[^\d]/g, ''));
  expect(afterMin).toBeLessThan(before);

  await panel.locator('select').nth(3).selectOption('recent');
  const afterNews = Number((await shown.innerText()).replace(/[^\d]/g, ''));
  expect(afterNews).toBeLessThanOrEqual(afterMin);
  await expect(page.locator('tbody tr').first()).toBeVisible();
});
