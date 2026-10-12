import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync('work/local-demo.json', 'utf8'));
assert.equal(config.status, 'local', 'browser smoke requires the explicit localhost demo manifest');
assert.match(config.rpcUrl, /^http:\/\/(localhost|127\.0\.0\.1):/);

const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15_000);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto('http://127.0.0.1:5173/?view=markets', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Explore markets', exact: true }).waitFor();
  await expect(page.locator('.market-results')).toContainText(/^2 markets/, { timeout: 15_000 });
  await page.getByRole('button', { name: /Local demo: what temperature/ }).click();
  await page.getByText('Rules verified').waitFor();

  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.locator('.wallet-button')).toHaveAttribute('title', new RegExp(config.accounts[0], 'i'));
  const accountPicker = page.getByRole('combobox', { name: 'Disposable demo wallet' });
  await accountPicker.selectOption(config.accounts[1]);
  await page.getByRole('button', { name: /7099/ }).waitFor();
  assert.equal(await accountPicker.inputValue(), config.accounts[1], 'local account picker must follow the active wallet');
  const meanInput = page.locator('#forecast-mean');
  await meanInput.fill(String(Number(await meanInput.inputValue()) + 1));
  await page.getByRole('button', { name: 'Review forecast' }).click();
  await page.getByRole('button', { name: /Approve 10(?:\.00)? USDC/ }).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Submit forecast' }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Submit forecast' }).click();
  await page.getByText(/Submit forecast confirmed/).waitFor({ timeout: 60_000 });

  await accountPicker.selectOption(config.accounts[2]);
  await page.getByRole('button', { name: /3c44/i }).waitFor();
  assert.equal(await accountPicker.inputValue(), config.accounts[2], 'second local trader must become the active wallet');
  await meanInput.fill(String(Number(await meanInput.inputValue()) + 1));
  await page.getByRole('button', { name: 'Review forecast' }).click();
  await page.getByRole('button', { name: /Approve 10(?:\.00)? USDC/ }).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Submit forecast' }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Submit forecast' }).click();
  await page.getByText(/Submit forecast confirmed/).waitFor({ timeout: 60_000 });

  await accountPicker.selectOption(config.accounts[1]);
  await page.getByRole('button', { name: /7099/ }).waitFor();
  await page.getByRole('button', { name: 'My positions' }).click();
  await page.getByRole('heading', { name: 'My positions.' }).waitFor();
  await page.getByText('Deposited collateral').first().waitFor();
  await page.screenshot({ path: 'work/browser-demo.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'My positions' }).click();
  await page.getByText('Deposited collateral').first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const width = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(width.document <= width.viewport + 1, `mobile layout overflows horizontally: ${JSON.stringify(width)}`);
  await page.goto('http://127.0.0.1:5173/?view=markets', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Explore markets', exact: true }).waitFor();
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.activeElement?.classList.contains('skip-link'));
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);
  console.log('Browser smoke passed: two local traders changed the same market, exact approvals and trades confirmed, positions recovered after reload, 390px mobile layout fit, and keyboard skip link focused. Screenshot: work/browser-demo.png');
} finally {
  await browser.close();
}
