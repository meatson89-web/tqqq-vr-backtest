import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
await page.goto('https://mks.nexuslogic.cloud/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'VR 5.0', exact: true }).click();
await page.waitForTimeout(500);

const inputs = page.locator('input, select, button');

// 초기 Pool($)
await inputs.nth(6).fill('67190');
// 초기 V($)
await inputs.nth(8).fill('67190');
// G값 already 10
// 수수료 already 0.25
// 시작일
await inputs.nth(12).fill('2019-05-05');
// 유형 already 적립식
// 실력공식 button
await inputs.nth(16).click();
// 적립금(+)/인출금($)
await inputs.nth(17).fill('1150');
// 밴드폭 ±15%
await inputs.nth(18).click();
// 종료일 사용 already checked
// 종료일
await inputs.nth(24).fill('2024-05-05');

await page.waitForTimeout(300);
await page.screenshot({ path: 'tmp_mks_filled.png', fullPage: true });

// verify values before submit
const check = await inputs.evaluateAll(els => [6,8,10,11,12,17,24].map(i => els[i]?.value));
console.log('field values [pool,v,g,fee,start,deposit,end]:', check);

await inputs.nth(25).click(); // 백테스트 실행
await page.waitForTimeout(3000);
await page.screenshot({ path: 'tmp_mks_result.png', fullPage: true });

const bodyText = await page.evaluate(() => document.body.innerText);
console.log('=== BODY TEXT ===');
console.log(bodyText);

await browser.close();
