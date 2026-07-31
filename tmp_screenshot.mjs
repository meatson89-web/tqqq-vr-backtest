import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('text=백테스트 실행');
await page.click('text=백테스트 실행');
await page.waitForSelector('text=단순적립 (매도 없음, 비교용)');
await page.screenshot({ path: 'tmp_screenshot.png', fullPage: true });
console.log('CONSOLE ERRORS:', JSON.stringify(errors));
await browser.close();
