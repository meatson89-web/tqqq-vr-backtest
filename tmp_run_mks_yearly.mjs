import { chromium } from 'playwright';
import fs from 'fs';

const PERIODS = [
  ['2011-05-12','2016-05-13'],
  ['2012-05-11','2017-05-15'],
  ['2013-05-15','2018-05-15'],
  ['2014-05-15','2019-05-16'],
  ['2015-05-15','2020-05-15'],
  ['2016-05-16','2021-05-17'],
  ['2017-05-16','2022-05-16'],
  ['2018-05-16','2023-05-17'],
  ['2019-05-17','2024-05-17'],
  ['2020-05-18','2025-05-21'],
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
for (const [start, end] of PERIODS) {
  await inputs.nth(12).fill(start);
  await inputs.nth(24).fill(end);
  await page.waitForTimeout(200);
  await inputs.nth(25).click();
  await page.waitForTimeout(2000);
  const bodyText = await page.evaluate(() => document.body.innerText);
  const extract = (re) => (bodyText.match(re) || [])[1];
  const invested = extract(/누적 투입 → 평가금\+POOL\s*\$?([\d,]+)/);
  const finalTotal = extract(/누적 투입 → 평가금\+POOL\s*\$[\d,]+\s*→\s*\$?([\d,.]+)/);
  const returnPct = extract(/수익률\(투입원금 대비\)\s*([+\-][\d.]+%)/);
  const mdd = extract(/최대 낙폭\(MDD\)\s*(-[\d.]+%)/);
  const days = extract(/·\s*(\d+)일/);
  const r = { start, end, invested, finalTotal, returnPct, mdd, days };
  console.log(JSON.stringify(r));
  results.push(r);
}

fs.writeFileSync('tmp_vr_yearly.json', JSON.stringify(results, null, 2));
await browser.close();
