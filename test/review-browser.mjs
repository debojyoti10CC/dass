import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { webFingerprints } from '../scripts/release-gate.mjs';

// Test-only wallet read adapter. Market data, balances, simulations and fees use actual Arc RPC.
// It cannot sign or broadcast. This proves review recovery, not a user's wallet approval flow.
const manifest = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
const acceptance = JSON.parse(fs.readFileSync('deployments/arc-testnet-acceptance-evidence.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route(manifest.rpcUrl, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'rate limit exceeded' } }) }));
  await page.addInitScript(({ account, chainId }) => {
    window.__holdWalletRead = false;
    window.__heldWalletRead = false;
    window.__writeRequests = [];
    window.ethereum = { request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
      if (method === 'eth_chainId') {
        if (window.__holdWalletRead) { window.__heldWalletRead = true; return new Promise(() => {}); }
        return `0x${chainId.toString(16)}`;
      }
      window.__writeRequests.push(method);
      throw new Error('The regression wallet cannot sign or broadcast');
    } };
  }, { account: acceptance.wallets['trader-a'], chainId: manifest.chainId });
  await page.goto(process.env.DASS_BROWSER_URL ?? 'http://127.0.0.1:5180/');
  await page.getByRole('button', { name: /Everton vs Chelsea/ }).click({ timeout: 60000 });
  await expect(page.getByText('Rules verified', { exact: true })).toBeVisible();
  await page.locator('#forecast-mean').fill('3.1');
  await expect(page.getByRole('button', { name: 'Review forecast' })).toBeEnabled({ timeout: 15000 });
  await page.clock.install();
  await page.evaluate(() => { window.__holdWalletRead = true; });
  await page.getByRole('button', { name: 'Review forecast' }).click();
  await page.waitForFunction(() => window.__heldWalletRead, null, { timeout: 20000 });
  await page.clock.fastForward(35001);
  await expect(page.getByRole('alert').filter({ hasText: 'Forecast review timed out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review forecast' })).toBeEnabled();
  await page.evaluate(() => { window.__holdWalletRead = false; });
  await page.getByRole('button', { name: 'Review forecast' }).click();
  await expect(page.getByRole('button', { name: /Approve 1\.00 USDC|Submit forecast/ })).toBeVisible({ timeout: 35000 });
  await expect(page.getByText('REVIEW YOUR FORECAST', { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.__writeRequests), [], 'Preparing a review cannot request signing or broadcasting');
  assert.deepEqual(errors, []);
  fs.writeFileSync('deployments/arc-testnet-review-evidence.json', JSON.stringify({ checkedAt: new Date().toISOString(), chainId: manifest.chainId, contract: manifest.address, passed: true,
    webSourceFiles: webFingerprints(),
    walletAdapter: 'Test-only read identity for an actual funded testnet account; cannot sign or broadcast',
    data: 'Actual public Arc RPC records, USDC balance/allowance, contract simulation and fee estimates through the verified secondary RPC',
    faultInjection: 'Primary RPC returns explicit -32005 throttling; wallet read is temporarily held',
    checks: ['Primary RPC throttling falls back to the actual secondary RPC', 'Stalled wallet read stops preparation within 35 seconds', 'Review button recovers after timeout', 'Fresh review produces an actionable approval or submission preview', 'Preparation requests no signatures or transactions', 'Zero browser errors'] }, null, 2) + '\n');
  console.log('Review recovery and actual Arc RPC simulation passed. No signing or broadcasting was performed.');
} finally { await browser.close(); }
