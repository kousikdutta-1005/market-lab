import type { Screen, Stock } from '../types';

export function exportToCsv(screen: Screen, stocks?: Stock[]) {
  // Analysts export what they are currently looking at, not the raw universe. Exporting
  // all 1,600 rows after someone spent time narrowing to 12 throws away the actual work.
  const rows_ = stocks?.length ? stocks : screen.stocks;
  const headers = [
    'Symbol', 'Name', 'Sector', 'Size Bucket', 'Price', 'Market Cap (Cr)',
    'Opportunity Score', 'Short Fit', 'Medium Fit', 'Long Fit',
    'Delivery Score', 'Delivery % Latest', 'Deal Score', 'News Score', 'Risk Level',
    'Composite', 'Turnover (Cr)', 'P/E', 'P/B', 'EV/EBITDA', 'ROE', 'ROA'
  ];

  const rows = rows_.map(s => [
    s.symbol,
    `"${s.name?.replace(/"/g, '""') ?? ''}"`,
    s.sector ?? '',
    s.bucket ?? '',
    s.price ?? '',
    s.market_cap ? (s.market_cap / 10000000).toFixed(2) : '',
    s.opportunity_score?.toFixed(1) ?? '',
    s.short_fit?.toFixed(1) ?? '',
    s.medium_fit?.toFixed(1) ?? '',
    s.long_fit?.toFixed(1) ?? '',
    s.delivery_accumulation_score?.toFixed(1) ?? '',
    s.delivery_pct_latest?.toFixed(2) ?? '',
    s.deal_activity_score?.toFixed(1) ?? '',
    s.news_event_score?.toFixed(1) ?? '',
    s.risk_level ?? '',
    s.composite?.toFixed(1) ?? '',
    s.turnover_median ? (s.turnover_median / 10000000).toFixed(2) : '',
    s.pe?.toFixed(2) ?? '',
    s.pb?.toFixed(2) ?? '',
    s.ev_ebitda?.toFixed(2) ?? '',
    s.roe ? (s.roe * 100).toFixed(2) : '',
    s.roa ? (s.roa * 100).toFixed(2) : ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `market-lab-${screen.last_trading_session}-${rows_.length}-stocks.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
