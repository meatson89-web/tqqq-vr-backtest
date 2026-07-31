import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto('https://mks.nexuslogic.cloud/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const inputs = await page.$$eval('input, select, button', els => els.map(e => ({
  tag: e.tagName, type: e.type, id: e.id, name: e.name, value: e.value,
  placeholder: e.placeholder, text: e.innerText?.slice(0, 30), checked: e.checked,
})));
console.log('=== FORM ELEMENTS ===');
console.log(JSON.stringify(inputs, null, 2));

await page.screenshot({ path: 'tmp_mks_full.png', fullPage: true });
await browser.close();
