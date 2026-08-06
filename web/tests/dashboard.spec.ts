import { readFileSync } from 'node:fs';
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

  await page.getByRole('button', { name: 'Screener' }).first().click();
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15000 });
  expect(await rows.count()).toBeGreaterThanOrEqual(25);
  // Paginated: the full result set is reported in the footer, not rendered at once.
  await expect(page.getByText(/\d+–\d+ of [\d,]+/)).toBeVisible();

  expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('source panel reports the health of every data source', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Methodology' }).first().click();
  const panel = page.locator('section', { hasText: 'Data sources' }).first();
  await expect(panel).toBeVisible();

  const badge = panel.getByText(/\d+ of \d+ reachable/);
  await expect(badge).toBeVisible({ timeout: 30000 });
  const [up, total] = (await badge.innerText()).match(/(\d+) of (\d+)/)!.slice(1).map(Number);

  // The count must describe what is actually on screen. Asserting up === total would make
  // this test fail whenever a third party has a bad minute, which says nothing about this
  // codebase — what matters is that a degraded source is counted and shown, not hidden.
  expect(total).toBeGreaterThanOrEqual(8);
  const rows = panel.locator('div.divide-y > div');
  expect(await rows.count()).toBe(total);
  expect(up).toBeLessThanOrEqual(total);

  // The sources the board cannot be built without are not allowed to be down.
  for (const name of ['NSE bhavcopy', 'NSE index lists', 'NSE equity list']) {
    const row = panel.locator('div.divide-y > div').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.locator('.text-danger')).toHaveCount(0);
  }
});

test('caveats are shown before any score', async ({ page }) => {
  await page.goto(BASE);
  // Collapsed by default so it does not bury the board, but it must be findable and
  // must still contain the full, unedited disclosure once opened.
  await page.getByRole('button', { name: 'Methodology' }).first().click();
  const toggle = page.getByRole('button', { name: /Risk controls before using any score/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByText(/Survivorship bias/)).toBeVisible();
  await expect(page.getByText(/Mitigated/).first()).toBeVisible();
  await expect(page.getByText(/SEBI RIA\/RA registration/i).first()).toBeVisible();
});

test('selecting a stock opens an auditable breakdown', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
  await page.getByPlaceholder('Search symbol or company').fill('RELIANCE');
  await page.locator('tbody tr').first().click();

  const detail = page.locator('aside');
  await expect(detail).toBeVisible();
  // The factsheet is grouped into panes; every section must still be reachable.
  const panes: Record<string, string[]> = {
    Fundamentals: ['Company facts', 'Valuation', 'Profitability and growth'],
    Technicals: ['Returns and technicals', 'Liquidity and position size', 'Scorecard'],
  };
  for (const [pane, sections] of Object.entries(panes)) {
    await detail.getByRole('button', { name: pane }).click();
    for (const section of sections) {
      await expect(detail.getByRole('heading', { name: section })).toBeVisible();
    }
  }
  await detail.getByRole('button', { name: 'Fundamentals' }).click();
  await expect(detail.getByText('Return on equity', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(/not what the share price will do next/).first()).toBeVisible();
});

test('search and sort work', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
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
  // Pillar columns are Pro-only: Guided deliberately shows a decision-sized subset.
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: /^quality/i }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('data quality flags surface in the UI', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
  await page.getByPlaceholder('Search symbol or company').fill('IDEA');
  await page.locator('tbody tr').first().click();

  const detail = page.locator('aside');
  await expect(detail.getByText('Data quality flags')).toBeVisible();
  await expect(detail.getByText('negative_equity')).toBeVisible();
});

test('refresh button runs the pipeline and the board reflects it', async ({ page }) => {
  // This one really does run the pipeline, which talks to NSE. The default 30s budget was
  // shorter than the work it triggers, so a slow source failed the test rather than the code.
  test.setTimeout(180_000);
  await page.goto(BASE);

  const before = await page.getByText(/Close of \d{4}-\d{2}-\d{2}/).innerText();
  const btn = page.getByRole('button', { name: /Refresh data/i });
  await expect(btn).toBeEnabled();
  await btn.click();

  // Must actually enter a running state, not just look clickable.
  await expect(page.getByRole('button', { name: /Refreshing/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /^Refresh data/i })).toBeVisible({ timeout: 180000 });
  await expect(page.getByText('Refresh complete')).toBeVisible();

  // Age resets, proving the board re-read the freshly written file.
  await expect(page.getByText(/Close of \d{4}-\d{2}-\d{2}/)).not.toHaveText(before, { timeout: 15000 });
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
  await page.getByRole('button', { name: 'Screener' }).first().click();
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
  await page.getByRole('button', { name: 'Screener' }).first().click();
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
  await page.getByRole('button', { name: 'Methodology' }).first().click();
  await page.getByRole('button', { name: /stocks excluded from scoring/ }).click();
  const row = page.locator('section', { hasText: 'excluded from scoring' }).locator('tbody tr').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(/turnover|history|price|zero|stale/i);
});

test('horizon research-fit filters rank the board', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
  const panel = page.locator('section', { hasText: 'Filters' });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit 6-12m' })).toBeVisible();

  const shown = page.getByText(/^[\d,]+ shown$/);
  const before = Number((await shown.innerText()).replace(/[^\d]/g, ''));

  await panel.getByRole('button', { name: '3-5y' }).click();
  await expect(page.getByRole('button', { name: 'Fit 3-5y' })).toBeVisible();

  await panel.getByRole('combobox', { name: 'Minimum fit' }).click();
  await page.getByRole('option', { name: '90+' }).click();
  const afterMin = Number((await shown.innerText()).replace(/[^\d]/g, ''));
  expect(afterMin).toBeLessThan(before);

  await panel.getByRole('button', { name: /More filters/ }).click();
  await panel.getByRole('combobox', { name: 'Official events' }).click();
  await page.getByRole('option', { name: 'Has event in 14d' }).click();
  const afterNews = Number((await shown.innerText()).replace(/[^\d]/g, ''));
  expect(afterNews).toBeLessThanOrEqual(afterMin);
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('opportunity cards carry a full research case, not just a score', async ({ page }) => {
  await page.goto(BASE);
  const deck = page.locator('section', { hasText: 'Top ranked stocks' }).first();
  await expect(deck).toBeVisible();

  const card = deck.getByRole('button').first();
  // A decision needs horizon, risk, tradeability and the argument against — a bare
  // score is a tip, which is exactly what this tool refuses to be.
  await expect(card).toContainText(/Best suited for/);
  await expect(card).toContainText(/risk/i);
  await expect(card).toContainText(/Avg daily turnover/);
  await expect(card).toContainText(/₹1L order impact/);
  await expect(card).toContainText(/Weakest on/);
});

test('guided hides analyst columns that pro shows', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
  const headers = page.locator('thead th');
  const guided = await headers.count();
  await expect(page.getByRole('button', { name: /^quality/i })).toHaveCount(0);

  await page.getByRole('button', { name: 'Advanced' }).click();
  const pro = await headers.count();
  expect(pro).toBeGreaterThan(guided);
  await expect(page.getByRole('button', { name: /^quality/i })).toBeVisible();
});

test('keyboard navigation drives the board', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
  await page.locator('tbody tr').first().waitFor();

  // j selects the first row and opens its factsheet.
  await page.keyboard.press('j');
  const detail = page.locator('aside');
  await expect(detail).toBeVisible();
  const first = await detail.getByRole('heading').first().innerText();

  // j again advances to the next stock.
  await page.keyboard.press('j');
  await expect(detail.getByRole('heading').first()).not.toHaveText(first);

  // Escape closes it.
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  // "/" focuses search without typing the slash into it.
  await page.keyboard.press('/');
  await expect(page.getByPlaceholder('Search symbol or company')).toBeFocused();
});

test('clicking an idea opens its factsheet from the Ideas tab', async ({ page }) => {
  // Regression: with tabs added, selecting a stock set state but rendered nothing,
  // because the factsheet only existed inside the Explore tab.
  await page.goto(BASE);
  const deck = page.locator('section', { hasText: 'Top ranked stocks' }).first();
  await deck.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Price, trend and participation' })).toBeVisible({
    timeout: 15000,
  });
});

test('mobile shows a bottom nav and a usable board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);

  const bottomNav = page.locator('nav[aria-label="Sections"]').last();
  await expect(bottomNav).toBeVisible();

  // Tab targets must be thumb-sized, not desktop-sized.
  const box = await bottomNav.getByRole('button', { name: /Screen/ }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await bottomNav.getByRole('button', { name: /Screen/ }).click();
  await expect(page.getByPlaceholder('Search symbol or company')).toBeVisible();

  await bottomNav.getByRole('button', { name: /Portfolio/ }).click();
  await expect(page.getByText(/Add your holdings/)).toBeVisible();
});

test('factsheet panes keep every section reachable', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('section', { hasText: 'Top ranked stocks' }).first().getByRole('button').first().click();
  const detail = page.locator('aside');
  await expect(detail).toBeVisible();

  // Grouping must not drop content: the union of panes has to cover the whole factsheet.
  const seen = new Set<string>();
  for (const pane of ['Overview', 'Risk & flow', 'Fundamentals', 'Technicals', 'Audit']) {
    await detail.getByRole('button', { name: pane }).click();
    for (const h of await detail.locator('h3').allInnerTexts()) seen.add(h);
  }
  expect(seen.size).toBeGreaterThanOrEqual(14);
  for (const must of ['Price, trend and participation', 'Risk lens', 'Valuation', 'Scorecard', 'Raw inputs by pillar']) {
    expect([...seen]).toContain(must);
  }
});

test('the assistant accepts any provider, not just Gemini', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'AI assistant' }).click();

  await page.getByRole('combobox', { name: 'AI provider' }).click();
  const offered = await page.getByRole('option').allInnerTexts();
  expect(offered).toEqual(
    expect.arrayContaining(['Google Gemini', 'OpenAI', 'Anthropic Claude', 'OpenAI-compatible / local']),
  );

  // A local model has no API key, so the flow must not insist on one.
  await page.getByRole('option', { name: /OpenAI-compatible/ }).click();
  await expect(page.getByLabel('API base URL')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect' })).toBeEnabled();
});

test('large-holder disclosures are visible without digging', async ({ page }) => {
  // These filings are among the highest-signal public disclosures available, so they
  // must appear where a stock appears — not only inside a sub-pane.
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();
  await page.getByRole('button', { name: /More filters/ }).click();
  await page.getByRole('combobox', { name: 'Flows' }).click();
  await page.getByRole('option', { name: 'Large-holder filing (180d)' }).click();

  const row = page.locator('tbody tr').first();
  await expect(row).toBeVisible();
  await expect(row.getByTitle(/SAST filing/)).toBeVisible();

  await row.click();
  const detail = page.locator('aside');
  await expect(detail.getByTitle(/SAST filing/).first()).toBeVisible();
  // Present on the Overview pane, before the user changes anything.
  await expect(detail.getByText(/now holds \d+\.\d+%/)).toBeVisible();
});

test('investors page lists filers and their disclosed positions', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Investors' }).first().click();

  // The framing matters as much as the data. It is one click away rather than in the way,
  // but the caveat itself must still be reachable and unedited.
  const caveat = page.getByRole('button', { name: /not a complete portfolio/i });
  await expect(caveat).toBeVisible();
  await caveat.click();
  await expect(page.getByText(/names every public holder\s+above\s+1% of a company/i)).toBeVisible();
  await expect(page.getByText(/someone sitting quietly on a stake files nothing/i)).toBeVisible();

  // Portfolios (quarterly filings) is the default view.
  await expect(page.getByText(/\d+ investors/)).toBeVisible();
  const holder = page.locator('tbody tr[data-investor]').first();
  await expect(holder).toBeVisible();
  await holder.click();
  await expect(page.getByText('Holdings above 1% of the company')).toBeVisible();

  // Recent activity (SAST + bulk deals) remains available.
  await page.getByRole('button', { name: 'Recent activity' }).click();
  const row = page.locator('tbody tr[data-investor]').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText('Disclosed positions')).toBeVisible();
});

test('investor tables sort by a clicked column', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Investors' }).first().click();

  const counts = async () =>
    (await page.locator('tbody tr[data-investor] td:nth-child(3)').allInnerTexts())
      .map((t) => Number(t.trim()))
      .filter((n) => !Number.isNaN(n));

  // Default is most holdings first.
  const desc = await counts();
  expect(desc.length).toBeGreaterThan(1);
  expect([...desc].sort((a, b) => b - a)).toEqual(desc);

  await page.getByRole('button', { name: /^Holdings/ }).click();
  const asc = await counts();
  expect([...asc].sort((a, b) => a - b)).toEqual(asc);
});

test('investors are split into individuals, funds, DIIs and FIIs', async ({ page }) => {
  // Category comes from the filing's own regulatory context, so these buckets must be
  // populated and must not collapse into one another.
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Investors' }).first().click();

  for (const bucket of ['Individuals', 'Mutual funds', 'DIIs', 'FIIs']) {
    await page.getByRole('button', { name: bucket, exact: true }).click();
    await expect(page.getByText(/\d+ investors/)).toBeVisible();
    await expect(page.locator('tbody tr[data-investor]').first()).toBeVisible();
  }
});

test('the screener table columns can be chosen and reset by preset', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();

  // Fundamentals are not in the default view.
  await expect(page.getByRole('columnheader', { name: /P\/E/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.getByRole('menuitem', { name: /Fundamentals/ }).click();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('columnheader', { name: /P\/E/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /ROE/ })).toBeVisible();
  // The pinned column survives every preset.
  await expect(page.getByRole('columnheader', { name: /Stock/ })).toBeVisible();

  // Individual columns toggle on top of a preset.
  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Volatility' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: /Volatility/ })).toBeVisible();
});

test('the screener explains itself when nothing matches', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();

  await page.getByPlaceholder('Search symbol or company…').fill('zzzznotasymbol');
  await expect(page.getByText('No stocks match these filters')).toBeVisible();

  await page.getByRole('button', { name: 'Clear search and sector' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('the screener exports every matching row, not just the page', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Screener' }).first().click();

  // Narrow to something small enough to count exactly.
  await page.getByPlaceholder('Search symbol or company…').fill('RELIANCE');
  const shown = Number((await page.getByText(/^[\d,]+ match$/).innerText()).replace(/[^\d]/g, ''));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  const path = await download.path();
  const text = readFileSync(path!, 'utf8').trim();
  const lines = text.split('\n');

  expect(lines[0]).toContain('Stock');
  expect(lines.length - 1).toBe(shown);
  expect(text).toContain('RELIANCE');
});
