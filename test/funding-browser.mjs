import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { webFingerprints } from '../scripts/release-gate.mjs';

// Read-only identities for actual public wallets. This test never requests faucet funds or signs.
const manifest = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
const { wallets } = JSON.parse(fs.readFileSync('deployments/arc-testnet-acceptance-evidence.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(({ account, chainId }) => {
    window.__fundingAccount = undefined;
    window.__walletWrites = [];
    const handlers = new Map();
    window.ethereum = {
      on: (event, handler) => handlers.set(event, handler),
      removeListener: (event, handler) => { if (handlers.get(event) === handler) handlers.delete(event); },
      request: async ({ method }) => {
        if (method === 'eth_accounts') return window.__fundingAccount ? [window.__fundingAccount] : [];
        if (method === 'eth_requestAccounts') { window.__fundingAccount = account; return [account]; }
        if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
        window.__walletWrites.push(method); throw new Error('Read-only test wallet cannot sign');
      },
    };
    window.__changeFundingAccount = next => { window.__fundingAccount = next; handlers.get('accountsChanged')?.(next ? [next] : []); };
  }, { account: wallets['trader-a'], chainId: manifest.chainId });
  const appURL = new URL(process.env.DASS_BROWSER_URL ?? 'http://127.0.0.1:5180/');
  appURL.searchParams.set('view', 'markets');
  await page.goto(appURL.href);
  const trigger = page.getByRole('button', { name: 'Fund test wallet', exact: true });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Fund your test wallet.' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Open Circle faucet' })).toHaveAttribute('href', 'https://faucet.circle.com/');
  await expect(panel.getByRole('link', { name: 'Open Circle faucet' })).toHaveAttribute('target', '_blank');
  await expect(panel.getByRole('button', { name: 'Refresh balance' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await panel.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(panel.getByLabel('Connected wallet address')).toHaveValue(wallets['trader-a']);
  await expect(panel.getByRole('status').filter({ hasText: 'Balance refreshed' })).toBeVisible({ timeout: 30000 });
  const balance = await panel.locator('.funding-balance strong').innerText();
  assert.match(balance, /^[\d,.]+ USDC$/);
  await panel.getByRole('button', { name: 'Copy wallet address' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), wallets['trader-a']);
  await expect(panel.getByRole('button', { name: 'Address copied' })).toBeVisible();
  await page.evaluate(account => window.__changeFundingAccount(account), wallets['trader-b']);
  await expect(panel.getByLabel('Connected wallet address')).toHaveValue(wallets['trader-b']);
  await expect(panel.getByRole('button', { name: 'Copy wallet address' })).toBeVisible();
  await expect(panel.getByRole('status').filter({ hasText: 'Balance refreshed' })).toBeVisible({ timeout: 30000 });
  await panel.getByRole('button', { name: 'Copy wallet address' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), wallets['trader-b']);
  await panel.getByRole('button', { name: 'Refresh balance', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Balance refreshed' })).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: '../outputs/DAZZ-Markets-funding.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page must not overflow');
  assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), 'Mobile funding panel must not overflow');
  await panel.getByRole('link', { name: 'Open Circle faucet' }).scrollIntoViewIfNeeded();
  await expect(panel.getByRole('link', { name: 'Open Circle faucet' })).toBeVisible();
  await panel.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: '../outputs/DAZZ-Markets-funding-mobile.png' });
  await page.evaluate(() => window.__changeFundingAccount(undefined));
  await expect(panel.getByLabel('Connected wallet address')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.__walletWrites), []);
  assert.deepEqual(errors, []);
  fs.writeFileSync('deployments/arc-testnet-funding-evidence.json', JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, chainId: manifest.chainId, contract: manifest.address, webSourceFiles: webFingerprints(), faucet: 'https://faucet.circle.com/', walletAdapter: 'Read-only test identities for actual funded public wallets; cannot sign', displayedBalance: balance, checks: ['Official Circle faucet opens in a separate tab', 'Disconnected wallet can connect inside funding panel', 'Live balance read from public Arc Testnet RPC', 'Clipboard contains exact connected account', 'Account change resets copied address and balance', 'Manual balance refresh', 'Disconnect removes recipient and balance', 'Escape closes dialog and restores keyboard focus', '390px page and funding panel without horizontal overflow', 'No wallet signatures or transaction requests', 'No faucet request sent', 'Zero browser errors'] }, null, 2) + '\n');
  console.log('Testnet funding UI passed with actual Arc balances. No faucet funds or transactions requested.');
} finally { await browser.close(); }
