import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto('https://mks.nexuslogic.cloud/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'VR 5.0', exact: true }).click();
await page.waitForTimeout(800);

const inputs = await page.$$eval('input, select, button', els => els.map((e, i) => ({
  i, tag: e.tagName, type: e.type, value: e.value,
  text: e.innerText?.slice(0, 30), checked: e.checked,
  aria: e.getAttribute('aria-label'),
  labelText: (() => {
    const wrap = e.closest('div');
    return wrap ? wrap.parentElement?.querySelector('label, .label, [class*=label]')?.innerText?.slice(0,30) : null;
  })(),
})));
console.log(JSON.stringify(inputs, null, 2));

await page.screenshot({ path: 'tmp_mks_vr5.png', fullPage: true });
await browser.close();
