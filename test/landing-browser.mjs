import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';

const url = process.env.LANDING_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// Keep this landing check independent of public RPC availability.
await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
fs.mkdirSync('work', { recursive: true });

async function chapter(index) {
  await page.locator(`[data-step="${index}"]`).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const target = innerWidth <= 760 ? .75 : .5;
    window.scrollTo({ top: scrollY + bounds.top + bounds.height / 2 - innerHeight * target, behavior: 'instant' });
  });
  await expect(page.locator('.story-chart-panel')).toHaveAttribute('data-stage', String(index));
  await expect(page.locator('.story-step-links [aria-current="step"]')).toHaveAttribute('href', `#${['forecast', 'change', 'collateral', 'settlement'][index]}`);
}

try {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/DISTRIBUTED\s*PREDICTION MARKET\s*ON ARC/);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#landing-main$/);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('main')?.id), 'landing-main');

  for (const index of [0, 1, 2, 3, 2, 1, 0, 3]) await chapter(index);
  await expect(page.locator('.story-chart-panel .settlement-marker')).toBeVisible();
  const payouts = (await page.locator('.ledger-payout strong').allTextContents()).map(Number);
  assert.ok(Math.abs(payouts[0] - 1.3) < .05, 'Illustrative trader payout should be approximately 1.3 USDC');
  assert.equal(Math.round((payouts[0] + payouts[1]) * 1e6), 2000000, 'Trader and sponsor conserve both deposits');
  await expect(page.locator('.story-readout')).toContainText(payouts[0].toFixed(6));
  await expect(page.locator('.ledger-total strong')).toHaveText('2.000000');

  const details = page.locator('.repo-map details').filter({ has: page.locator('summary code', { hasText: /^contracts\/$/ }) });
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.getByRole('link', { name: 'DistributionMarkets.sol', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(details).not.toHaveAttribute('open', '');

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
    // Reload installs the mobile observer margins used by the actual page.
    for (const index of [0, 1, 2, 3, 2, 1, 0]) await chapter(index);
    if (width !== 320) {
      await chapter(3);
      await page.screenshot({ path: `work/landing-settlement-${width}.png` });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: `work/landing-${width}.png`, fullPage: true });
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  assert.equal(await page.locator('.landing-button').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await chapter(3);
  await expect(page.locator('.story-chart-panel .settlement-marker')).toBeVisible();
  await page.locator('.landing-header').getByRole('link', { name: /Join the waitlist/ }).click();
  await expect(page).toHaveURL(/\?view=markets$/);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'My positions', exact: true })).toBeVisible();
  await expect(page.locator('.landing')).toHaveCount(0);
  await page.getByRole('link', { name: 'Dass home', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/DISTRIBUTED\s*PREDICTION MARKET\s*ON ARC/);
  assert.deepEqual(errors, []);
  console.log('Landing keyboard, scroll reversal, settlement conservation, repository details, responsive layout, reduced motion, and markets routing passed.');
} finally {
  await browser.close();
}
