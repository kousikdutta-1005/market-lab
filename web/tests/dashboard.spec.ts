import { expect, test } from '@playwright/test';

const BASE = process.env.ML_BASE ?? 'http://localhost:5177';

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

  // Table must actually be populated, not merely present.
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15000 });
  expect(await rows.count()).toBeGreaterThan(50);

  expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('api health panel reports every source connected', async ({ page }) => {
  await page.goto(BASE);
  const panel = page.locator('section', { hasText: 'Data source connectivity' }).first();
  await expect(panel).toBeVisible();

  const badge = panel.getByText(/\d+\/\d+ connected/);
  await expect(badge).toBeVisible();
  const [up, total] = (await badge.innerText()).match(/(\d+)\/(\d+)/)!.slice(1).map(Number);
  expect(up).toBe(total);

  for (const name of ['AMFI NAVAll', 'mfapi.in', 'Yahoo chart', 'Yahoo statements', 'NSE archives']) {
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
  await page.locator('tbody tr').first().click();

  const detail = page.locator('aside');
  await expect(detail).toBeVisible();
  for (const pillar of ['Quality', 'Growth', 'Valuation', 'Trend', 'Momentum']) {
    await expect(detail.getByRole('heading', { name: pillar })).toBeVisible();
  }
  await expect(detail.getByText('Return on equity', { exact: true })).toBeVisible();
  await expect(detail.getByText(/not what the share price will do next/)).toBeVisible();
});

test('search and sort work', async ({ page }) => {
  await page.goto(BASE);
  const search = page.getByPlaceholder('Search ticker or company');
  await search.fill('RELIANCE');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('RELIANCE');

  await search.fill('');
  await page.getByRole('button', { name: /^quality/i }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('data quality flags surface in the UI', async ({ page }) => {
  await page.goto(BASE);
  await page.getByPlaceholder('Search ticker or company').fill('IDEA');
  await page.locator('tbody tr').first().click();

  const detail = page.locator('aside');
  await expect(detail.getByText('Data quality flags')).toBeVisible();
  await expect(detail.getByText('negative_equity')).toBeVisible();
});
