import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, keccak256, parseUnits, toBytes } from 'viem';
import { chainlinkClient, chainlinkPolicy, chainlinkSource } from '../scripts/chainlink-oracle.mjs';
import { canonical } from '../scripts/public-runtime.mjs';
import { resolveCoinbase } from '../scripts/resolve-coinbase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rpcPort = 8557, webPort = 5181, rpcUrl = `http://127.0.0.1:${rpcPort}`, appUrl = `http://127.0.0.1:${webPort}/?view=markets`;
const now = Math.floor(Date.now() / 1000), end = Math.floor(now / 300) * 300 - 300, start = end - 300;
const WAD = 10n ** 18n, backing = 1_000_000n, chainlink = chainlinkPolicy('arc-testnet');
const iso = value => new Date(value * 1000).toISOString();
const rules = question => ({
  kind: 'btc-five-minute-direction', question, category: 'Crypto', source: chainlinkSource(chainlink), chainlink,
  windowStart: iso(start), windowEnd: iso(end), observationAt: iso(end), earliestRetrievalAt: iso(end),
  field: 'Compare the positive latestRoundData().answer from the first confirmed source-chain block at or after each window boundary, using the committed feed decimals.',
  publicationPolicy: 'Sample BTC/USD Chainlink at the first confirmed source-chain block at or after windowStart and windowEnd, exactly 300 seconds apart. Up if end answer is greater than or equal to start answer; Down only if lower. No exchange fallback or later-price substitution.',
  units: 'BTC direction', normalization: { origin: '0', scale: '1' },
  precision: 'Binary outcome: 0=Down, 1=Up; end price equal to start price resolves Up.',
  rounding: 'No rounding; compare the exact positive integer Chainlink answers.',
  tiePolicy: 'Up when end price is equal to or greater than start price; Down only when lower.',
  binaryOutcomes: [{ outcome: 'Down', value: '0' }, { outcome: 'Up', value: '1' }],
  missingData: 'Missing feed, historical RPC state, invalid/stale round or out-of-bounds value blocks resolution. Anyone can cancel at expiry for original-deposit refunds.',
  evidencePolicy: 'Archive both exact feed round snapshots and their source-chain block hashes; verify each snapshot against historical chain state before signing and commit the canonical evidence hash.',
  resolverModel: 'Trusted local E2E resolver reads the committed Chainlink feed with historical block and round validation. The market contract trusts its resolver wallet.',
  initialForecastPolicy: 'The initial curve is a neutral midpoint forecast, not external odds. Every later curve is read from confirmed onchain state.',
});

const children = [];
let browser;
const trackedFixtureFiles = ['web/public/rules/local-fixture-1.json', 'web/public/rules/local-fixture-2.json'];
const savedFixtures = new Map(trackedFixtureFiles.map(file => [file, execFileSync('git', ['show', `HEAD:${file}`], { cwd: root })]));
const generatedFiles = ['web/src/contracts.ts', 'deployments/local.json', 'work/local-demo.json'];
const savedGenerated = new Map(generatedFiles.map(file => [file, fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : null]));
const saveTracked = (file, bytes) => fs.writeFileSync(path.join(root, file), bytes);
function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'ignore', windowsHide: true, ...options });
  children.push(child);
  child.on('exit', code => { if (code && code !== 130) console.error(`${path.basename(command)} exited ${code}`); });
  return child;
}
async function waitFor(check, label, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await check()) return; } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
async function transact(client, wallet, address, abi, functionName, args) {
  const { request } = await client.simulateContract({ account: wallet.account, address, abi, functionName, args });
  const gas = await client.estimateContractGas({ account: wallet.account, address, abi, functionName, args });
  const hash = await wallet.writeContract({ ...request, gas: gas * 120n / 100n });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30000 });
  assert.equal(receipt.status, 'success', `${functionName} reverted`);
  return receipt;
}

try {
  // A completed live source window is replayed on a disposable local chain clock.
  const genesis = start - 180;
  const cachePath = './work/btc-direction-anvil-cache';
  launch(path.join(root, 'work/arc-foundry/anvil'), ['--network', 'arc', '--chain-id', '5042002', '--host', '127.0.0.1', '--port', String(rpcPort), '--quiet', '--cache-path', cachePath, '--timestamp', String(genesis)]);
  await waitFor(async () => Number(BigInt(await rpc('eth_chainId'))) === 5042002, 'isolated local Arc node');
  const env = { ...process.env, LOCAL_RPC_URL: rpcUrl, ARC_LOCAL_PORT: String(rpcPort), DASS_DEPLOYMENT: 'local' };
  execFileSync(process.execPath, ['scripts/seed-local.mjs'], { cwd: root, env, stdio: 'ignore' });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'deployments/local.json'), 'utf8'));
  const demo = JSON.parse(fs.readFileSync(path.join(root, 'work/local-demo.json'), 'utf8'));
  const chain = defineChain({ id: 5042002, name: 'Local Arc E2E', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 100 });
  const abi = JSON.parse(fs.readFileSync(path.join(root, 'work/artifacts/DistributionMarkets.json'), 'utf8')).abi;
  const wallets = demo.accounts.map(account => createWalletClient({ chain, account, transport: http(rpcUrl) }));
  const [operator, traderA, traderB, resolver] = wallets;
  const token = manifest.tokenAddress, contract = manifest.address;
  assert.ok((await client.getBlock()).timestamp < BigInt(start), 'local clock must begin before the five-minute window');

  const marketIds = {};
  await transact(client, operator, token, erc20Abi, 'approve', [contract, 2n * backing]);
  for (const [slug, question] of [['btc-e2e-resolved', 'BTC Up or Down · resolved local E2E'], ['btc-e2e-expiry', 'BTC Up or Down · expiry local E2E']]) {
    const doc = rules(question), bytes = JSON.stringify(canonical(doc)), file = `web/public/rules/${slug}.json`;
    saveTracked(file, Buffer.from(bytes));
    const config = {
      resolver: resolver.account.address, rulesHash: keccak256(toBytes(bytes)), rulesURI: `/rules/${slug}.json`, units: doc.units,
      origin: 0n, scale: WAD, outcomeStep: WAD, backing, k: WAD / 2n,
      minMean: 0n, maxMean: WAD, minSigma: WAD / 2n, maxSigma: WAD / 2n,
      minOutcome: 0n, maxOutcome: WAD, closeAt: BigInt(start), resolveBy: BigInt(end + 3600),
    };
    const receipt = await transact(client, operator, contract, abi, 'createMarket', [config, { mean: WAD / 2n, sigma: WAD / 2n }]);
    const marketId = await client.readContract({ address: contract, abi, functionName: 'marketCount' });
    assert.equal(receipt.status, 'success');
    marketIds[slug] = marketId;
  }
  assert.ok((await client.getBlock()).timestamp < BigInt(start), 'seed transactions must leave time to trade before close');

  launch(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: path.join(root, 'web'), env });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${webPort}/`)).ok, 'local BTC app');
  browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /BTC Up or Down · resolved local E2E/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /BTC Up or Down · expiry local E2E/ })).toBeVisible();
  await page.getByRole('button', { name: /BTC Up or Down · resolved local E2E/ }).click();
  await expect(page.getByText('Rules verified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  const accountPicker = page.getByLabel('Disposable demo wallet');
  await expect(accountPicker).toBeVisible();

  async function trade(slug, traderIndex, direction) {
    const wallet = wallets[traderIndex], question = slug === 'btc-e2e-resolved' ? 'BTC Up or Down · resolved local E2E' : 'BTC Up or Down · expiry local E2E';
    await accountPicker.selectOption(wallet.account.address);
    await expect.poll(() => accountPicker.inputValue()).toBe(wallet.account.address);
    await page.getByRole('button', { name: 'Markets', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(question) }).click();
    await expect(page.getByText('Rules verified', { exact: true })).toBeVisible();
    const choices = page.getByRole('group', { name: 'Choose BTC direction' });
    const selected = choices.getByRole('button', { name: new RegExp(`^${direction}\\b`) });
    if (direction === 'Up' && traderIndex === 1 && slug === 'btc-e2e-resolved') {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'direction market must fit a 390px viewport');
      await selected.focus();
      await page.keyboard.press('Enter');
      await page.screenshot({ path: path.join(root, 'work/btc-direction-browser-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    } else await selected.click();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Review forecast' }).click();
    await page.getByRole('button', { name: /Approve 1(?:\.00)? USDC/ }).click();
    const submit = page.getByRole('button', { name: 'Submit forecast' });
    try { await submit.waitFor({ timeout: 60000 }); }
    catch {
      const diagnostic = await page.locator('body').innerText();
      fs.writeFileSync(path.join(root, 'work/btc-direction-browser-failure.txt'), diagnostic);
      throw new Error(`Approval did not return to forecast submission: ${diagnostic.slice(-1600)}`);
    }
    await submit.click();
    await expect(page.getByText(/Submit forecast confirmed/)).toBeVisible();
  }

  await trade('btc-e2e-resolved', 1, 'Up');
  await trade('btc-e2e-resolved', 2, 'Down');
  await trade('btc-e2e-expiry', 1, 'Up');
  await trade('btc-e2e-expiry', 2, 'Down');
  for (const trader of [traderA, traderB]) {
    await accountPicker.selectOption(trader.account.address);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'My positions', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My positions.' })).toBeVisible();
    await expect(page.locator('.position-row')).toHaveCount(2);
  }

  const sourceClient = chainlinkClient(chainlink, client, 5042002);
  const snapshot = new Map();
  const fsMock = {
    existsSync: file => snapshot.has(file), readFileSync: file => { if (!snapshot.has(file)) throw new Error(`Missing E2E fixture ${file}`); return snapshot.get(file); },
    mkdirSync: () => {}, writeFileSync: (file, value) => snapshot.set(file, Buffer.from(value)),
  };
  const items = Object.entries(marketIds).map(([slug, id]) => ({ slug, marketId: String(id), closeAt: start, resolveBy: end + 3600, rules: rules(slug === 'btc-e2e-resolved' ? 'BTC Up or Down · resolved local E2E' : 'BTC Up or Down · expiry local E2E') }));
  const catalogFile = 'btc-direction-e2e-catalog.json';
  snapshot.set(catalogFile, Buffer.from(JSON.stringify({ markets: items })));
  const resolverRuntime = {
    manifest: { ...manifest, chainId: 5042002, address: contract }, account: resolver.account, client, abi,
    call: async (_action, address, contractAbi, functionName, args) => transact(client, resolver, address, contractAbi, functionName, args),
  };
  const mapFs = {
    ...fsMock,
    existsSync(file) { return file === catalogFile || snapshot.has(file); },
    readFileSync(file) { if (file === catalogFile) return snapshot.get(file); return fsMock.readFileSync(file); },
  };

  await rpc('evm_increaseTime', [Number(BigInt(end + 60) - (await client.getBlock()).timestamp)]);
  await rpc('evm_mine');
  await resolveCoinbase({ network: 'local', runtime: resolverRuntime, fileSystem: mapFs, oracleClient: sourceClient, catalogFile, resolutionFile: 'btc-direction-e2e-resolution.json', marketSlug: 'btc-e2e-resolved' });
  const resolution = JSON.parse(snapshot.get('btc-direction-e2e-resolution.json'));
  assert.ok(['0', '1'].includes(resolution.rawValue), 'trusted Chainlink resolver must produce a binary outcome');
  assert.equal((await client.readContract({ address: contract, abi, functionName: 'getMarket', args: [marketIds['btc-e2e-resolved']] })).status, 1);

  async function claimFor(account, buttonName, confirmationAction = buttonName) {
    await accountPicker.selectOption(account);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'My positions', exact: true }).click();
    const claim = page.getByRole('button', { name: buttonName });
    await expect(claim).toBeVisible();
    await claim.click();
    await expect(page.getByText(new RegExp(`${confirmationAction} confirmed`))).toBeVisible();
  }
  await claimFor(traderA.account.address, 'Claim payout');
  await claimFor(traderB.account.address, 'Claim payout');
  await claimFor(operator.account.address, 'Claim sponsor payout', 'Claim sponsor entitlement');
  let settled = await client.readContract({ address: contract, abi, functionName: 'getMarket', args: [marketIds['btc-e2e-resolved']] });
  assert.equal(settled.paid, settled.deposited);
  assert.equal(settled.deposited, 3n * backing);
  assert.equal(settled.sponsorClaimed, true);

  await rpc('evm_increaseTime', [Number(BigInt(end + 3601) - (await client.getBlock()).timestamp)]);
  await rpc('evm_mine');
  await accountPicker.selectOption(traderA.account.address);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Markets', exact: true }).click();
  await page.getByRole('button', { name: /BTC Up or Down · expiry local E2E/ }).click();
  await expect(page.getByRole('button', { name: 'Cancel expired market' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel expired market' }).click();
  await expect(page.getByText(/Cancel expired market confirmed/)).toBeVisible();
  await claimFor(traderA.account.address, 'Claim refund');
  await claimFor(traderB.account.address, 'Claim refund');
  await claimFor(operator.account.address, 'Claim backing refund', 'Claim sponsor entitlement');
  const expired = await client.readContract({ address: contract, abi, functionName: 'getMarket', args: [marketIds['btc-e2e-expiry']] });
  assert.equal(expired.status, 2);
  assert.equal(expired.paid, expired.deposited);
  assert.equal(expired.deposited, 3n * backing);
  assert.equal(expired.sponsorClaimed, true);
  const [tokenBalance, liability] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [contract] }),
    client.readContract({ address: contract, abi, functionName: 'totalLiability' }),
  ]);
  assert.equal(tokenBalance, liability, 'contract USDC must equal all remaining tracked liabilities');
  assert.deepEqual(errors, [], `browser page errors: ${errors.join('; ')}`);
  fs.writeFileSync(path.join(root, 'work/btc-direction-browser-e2e.json'), JSON.stringify({ checkedAt: new Date().toISOString(), chainId: 5042002, sourceWindowStart: iso(start), sourceWindowEnd: iso(end), localContract: contract, markets: Object.fromEntries(Object.entries(marketIds).map(([slug, id]) => [slug, String(id)])), resolution: { rawValue: resolution.rawValue, normalizedOutcome: resolution.normalizedOutcome, evidenceHash: resolution.evidenceHash }, claims: { resolvedDeposited: String(settled.deposited), resolvedPaid: String(settled.paid), expiredDeposited: String(expired.deposited), expiredPaid: String(expired.paid), tokenBalance: String(tokenBalance), liability: String(liability) }, checks: ['two direction outcomes traded through the browser', 'exact approval confirmed for both traders', 'positions recovered after reload', 'Chainlink start/end evidence validated by trusted resolver', 'both trader claims and sponsor claim conserved escrow', 'expired market cancelled and both traders plus sponsor refunded', 'no browser page errors'], passed: true }, null, 2) + '\n');
  console.log('Local BTC Up/Down browser lifecycle passed, including trusted Chainlink settlement and expiry refunds.');
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const child of children.reverse()) { child.kill('SIGTERM'); }
  await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 2000).unref(); } })));
  for (const [file, bytes] of savedFixtures) fs.writeFileSync(path.join(root, file), bytes);
  for (const [file, bytes] of savedGenerated) {
    if (bytes) fs.writeFileSync(path.join(root, file), bytes);
    else fs.rmSync(path.join(root, file), { force: true });
  }
  for (const slug of ['btc-e2e-resolved', 'btc-e2e-expiry']) fs.rmSync(path.join(root, `web/public/rules/${slug}.json`), { force: true });
}
