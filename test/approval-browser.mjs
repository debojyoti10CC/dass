import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { webFingerprints } from '../scripts/release-gate.mjs';

// Fault-injected wallet responses only. Reads/simulation use actual Arc Testnet RPC.
// The adapter cannot sign, and its synthetic unknown hash was never broadcast.
const manifest = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
const { wallets } = JSON.parse(fs.readFileSync('deployments/arc-testnet-acceptance-evidence.json', 'utf8'));
const unknownHash = `0x${'f1'.repeat(32)}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(({ account, chainId, hash }) => {
    window.__holdRead = false;
    window.__readHeld = false;
    window.__writeMode = 'hold';
    window.__walletRequests = [];
    window.ethereum = { request: async ({ method, params }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
      if (method === 'eth_chainId') {
        if (window.__holdRead) { window.__readHeld = true; return new Promise(resolve => { window.__releaseRead = () => resolve(`0x${chainId.toString(16)}`); }); }
        return `0x${chainId.toString(16)}`;
      }
      if (method === 'eth_sendTransaction') {
        window.__walletRequests.push(params[0]);
        if (window.__writeMode === 'hold') return new Promise((_, reject) => { window.__failWallet = () => reject({ code: -32005, message: 'Request is being rate limited' }); });
        if (window.__writeMode === 'reject') throw { code: 4001, message: 'User rejected the request' };
        if (window.__writeMode === 'unknown') return hash;
      }
      throw new Error(`Test wallet cannot sign or broadcast: ${method}`);
    } };
  }, { account: wallets['trader-a'], chainId: manifest.chainId, hash: unknownHash });
  let receiptReads = 0;
  for (const endpoint of [manifest.rpcUrl, 'https://rpc.blockdaemon.testnet.arc.io']) await page.route(endpoint, route => {
    const payload = route.request().postDataJSON();
    if (payload.method === 'eth_getTransactionReceipt' && payload.params?.[0] === unknownHash) {
      receiptReads++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: null }) });
    }
    if (endpoint === manifest.rpcUrl) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: payload.id, error: { code: -32005, message: 'rate limit exceeded' } }) });
    return route.continue();
  });
  await page.goto(process.env.DASS_BROWSER_URL ?? 'http://127.0.0.1:5180/');
  await page.getByRole('button', { name: /Everton vs Chelsea/ }).click({ timeout: 60000 });
  await page.locator('#forecast-sigma').fill('6.9');
  await page.getByRole('button', { name: 'Review forecast' }).click();
  const approval = page.getByRole('button', { name: 'Approve 1.00 USDC', exact: true });
  await expect(approval).toBeVisible({ timeout: 40000 });
  await page.clock.install();
  await page.evaluate(() => { window.__holdRead = true; });
  await approval.click();
  await page.waitForFunction(() => window.__readHeld, null, { timeout: 20000 });
  await page.clock.fastForward(35001);
  await expect(page.locator('.editor [role=alert]')).toContainText('Approval preparation timed out');
  await expect(approval).toBeEnabled();
  assert.deepEqual(await page.evaluate(() => window.__walletRequests), []);
  await page.evaluate(() => { window.__holdRead = false; window.__releaseRead(); });
  await page.getByRole('button', { name: 'Back to editing' }).click();
  await page.getByRole('button', { name: 'Review forecast' }).click();
  await expect(approval).toBeVisible({ timeout: 40000 });
  assert.deepEqual(await page.evaluate(() => window.__walletRequests), [], 'Late preparation must not request a transaction');
  await approval.click();
  await page.waitForFunction(() => window.__walletRequests.length === 1, null, { timeout: 40000 });
  await expect(page.getByRole('button', { name: 'Waiting for wallet…', exact: true })).toBeDisabled();
  await page.clock.fastForward(30001);
  await expect(page.locator('.editor [role=status]')).toContainText('Open your wallet and approve or reject');
  await expect(page.getByRole('button', { name: 'Back to editing' })).toBeDisabled();
  const request = await page.evaluate(() => window.__walletRequests[0]);
  assert.ok(BigInt(request.gas) > 0n, 'Pass the already-estimated gas limit to the wallet');
  assert.ok(BigInt(request.maxFeePerGas ?? request.gasPrice) > 0n, 'Pass the already-estimated fees to the wallet');
  await page.evaluate(() => window.__failWallet());
  await expect(page.locator('.editor [role=alert]')).toContainText('rate-limiting');
  await expect(page.locator('.editor [role=alert]')).toContainText('No transaction hash was returned');
  await expect(approval).toBeEnabled();
  await page.clock.fastForward(15001);
  await expect(page.locator('.editor [role=alert]')).toContainText('rate-limiting');
  await page.locator('.editor').screenshot({ path: '../outputs/DAZZ-Markets-approval-error.png' });
  await page.evaluate(() => { window.__writeMode = 'reject'; });
  await approval.click();
  await expect(page.locator('.editor [role=alert]')).toContainText('Wallet request rejected', { timeout: 40000 });
  await expect(approval).toBeEnabled();
  await page.evaluate(() => { window.__writeMode = 'unknown'; });
  await approval.click();
  await expect(page.getByRole('button', { name: 'Confirming transaction…', exact: true })).toBeDisabled({ timeout: 40000 });
  await expect(page.locator(`.editor a[href="${manifest.explorerUrl}/tx/${unknownHash}"]`)).toBeVisible();
  await expect.poll(() => receiptReads).toBeGreaterThan(0);
  await page.clock.fastForward(90001);
  await expect(page.locator('.editor [role=status]')).toContainText('confirmation unknown');
  await expect(page.getByRole('button', { name: 'Transaction unresolved', exact: true })).toBeDisabled();
  const before = receiptReads;
  await page.getByRole('button', { name: 'Check transaction status', exact: true }).click();
  await expect.poll(() => receiptReads).toBeGreaterThan(before);
  assert.equal(await page.evaluate(() => window.__walletRequests.length), 3, 'Reconciliation must not send another transaction');
  assert.deepEqual(errors, []);
  fs.writeFileSync('deployments/arc-testnet-approval-evidence.json', JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, contract: manifest.address, chainId: manifest.chainId, webSourceFiles: webFingerprints(), walletAdapter: 'Fault-injected read identity; cannot sign/broadcast. Unknown hash is synthetic and never submitted', publicReads: 'Actual Arc Testnet records, balances, simulation, gas and fees', checks: ['Unresponsive approval read times out at 35 seconds with inline error', 'Late read cannot request a wallet transaction', 'Wallet wait is distinct and remains blocked after a 30-second advisory', 'Prepared gas and fee estimates are included in wallet parameters', 'RPC rate-limit rejection stays beside the action after refresh', 'Wallet rejection recovers the action', 'Returned hash shows receipt-confirmation progress and explorer link', 'Receipt timeout records unknown state and blocks duplicate submission', 'Reconciliation reads the hash without another wallet request', 'Zero browser errors', 'No actual signature or broadcast'] }, null, 2) + '\n');
  console.log('Approval timeout, wallet wait/rejection, inline errors and unknown-hash recovery passed. No broadcast performed.');
} finally { await browser.close(); }
