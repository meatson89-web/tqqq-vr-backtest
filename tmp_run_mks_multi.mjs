import { chromium } from 'playwright';

const PERIODS = [
  { label: 'id0 초기(2010-2015)', start: '2010-02-11', end: '2015-02-12' },
  { label: 'id24 상승장(2016-2021)', start: '2016-02-16', end: '2021-02-16' },
  { label: 'id31 하락장포함(2017-2022)', start: '2017-11-13', end: '2022-11-14' },
  { label: 'id45 최근(2021-2026)', start: '2021-05-18', end: '2026-05-22' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
await page.goto('https://mks.nexuslogic.cloud/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'VR 5.0', exact: true }).click();
await page.waitForTimeout(500);

const inputs = page.locator('input, select, button');
await inputs.nth(6).fill('67190');
await inputs.nth(8).fill('67190');
await inputs.nth(16).click(); // 실력공식
await inputs.nth(17).fill('1150');
await inputs.nth(18).click(); // ±15%

const results = [];

for (const p of PERIODS) {
  await inputs.nth(12).fill(p.start);
  await inputs.nth(24).fill(p.end);
  await page.waitForTimeout(200);
  await inputs.nth(25).click();
  await page.waitForTimeout(2000);
  const bodyText = await page.evaluate(() => document.body.innerText);

  const extract = (re) => (bodyText.match(re) || [])[1];
  const summary = {
    label: p.label,
    cycles: extract(/VR 5\.0 · (\d+)사이클/),
    returnPct: extract(/수익률\(투입원금 대비\)\s*([+\-][\d.]+%)/),
    invested: extract(/누적 투입 → 평가금\+POOL\s*\$?([\d,]+)/),
    finalTotal: extract(/누적 투입 → 평가금\+POOL\s*\$[\d,]+\s*→\s*\$?([\d,.]+)/),
    period: extract(/기간\s*([\d-]+)\s*→\s*[\d-]+\s*·\s*\d+일/),
    periodEnd: extract(/기간\s*[\d-]+\s*→\s*([\d-]+)\s*·\s*\d+일/),
    days: extract(/·\s*(\d+)일/),
    mdd: extract(/최대 낙폭\(MDD\)\s*(-[\d.]+%)/),
    rebal: extract(/리밸런싱\s*매수 (\d+) · 매도 \d+/),
    rebalSell: extract(/리밸런싱\s*매수 \d+ · 매도 (\d+)/),
  };
  console.log(JSON.stringify(summary));
  results.push(summary);
  await page.screenshot({ path: `tmp_mks_${p.label.replace(/[^\w]/g, '_')}.png`, fullPage: true });
}

console.log('=== ALL RESULTS ===');
console.log(JSON.stringify(results, null, 2));

await browser.close();
