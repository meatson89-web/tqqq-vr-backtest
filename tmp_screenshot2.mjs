import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.click('text=백테스트 실행');
await page.waitForSelector('text=단순적립 (매도 없음, 비교용)');
const el = await page.$('.chart-wrap');
await el.screenshot({ path: 'tmp_chart.png' });
await browser.close();
