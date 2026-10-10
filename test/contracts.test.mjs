import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, defineChain, encodeFunctionData, keccak256, toBytes, zeroAddress } from 'viem';
import { compile } from '../scripts/compile.mjs';

const WAD = 10n ** 18n;
const B = 10_000_000n;
const K = 10n * WAD;
const initial = { mean: 0n, sigma: WAD };
let transport, publicClient, wallets, accounts, artifacts, token, marketContract, harness, checkpoint;
const localRpcUrl = process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:8547';
const rpc = (method, params = []) => publicClient.request({ method, params });
const read = (address, name, functionName, args = []) => publicClient.readContract({ address, abi: artifacts[name].abi, functionName, args });
const marketRead = (name, args = []) => read(marketContract, 'DistributionMarkets', name, args);
async function send(address, name, functionName, args = [], wallet = wallets[0]) {
  const simulation = await publicClient.simulateContract({ address, abi: artifacts[name].abi, functionName, args, account: wallet.account });
  const gas = await publicClient.estimateContractGas({ address, abi: artifacts[name].abi, functionName, args, account: wallet.account });
  const hash = await wallet.writeContract({ ...simulation.request, gas: gas * 120n / 100n, gasPrice: 25_000_000_000n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  return receipt;
}
const sendMarket = (name, args = [], wallet = wallets[0]) => send(marketContract, 'DistributionMarkets', name, args, wallet);
async function expectRevert(functionName, args = [], wallet = wallets[0]) {
  await assert.rejects(publicClient.simulateContract({ address: marketContract, abi: artifacts.DistributionMarkets.abi, functionName, args, account: wallet.account }));
}
async function now() { return (await publicClient.getBlock({ blockTag: 'latest' })).timestamp; }
async function advance(timestamp) {
  const delta = timestamp - await now();
  if (delta > 0n) await rpc('evm_increaseTime', [Number(delta)]);
  await rpc('evm_mine');
}
async function create(overrides = {}, curve = initial) {
  const timestamp = await now();
  const config = {
    resolver: accounts[3], rulesHash: keccak256(toBytes('committed rules')), rulesURI: 'https://example.test/rules.json', units: 'normalized units',
    origin: 0n, scale: WAD, outcomeStep: 10n ** 12n, backing: B, k: K,
    minMean: -1000n * WAD, maxMean: 1000n * WAD, minSigma: WAD, maxSigma: 100n * WAD,
    minOutcome: -1000n * WAD, maxOutcome: 1000n * WAD, closeAt: timestamp + 1000n, resolveBy: timestamp + 2000n, ...overrides,
  };
  await sendMarket('createMarket', [config, curve]);
  return { id: await marketRead('marketCount'), config };
}
async function trade(id, curve, wallet = wallets[1]) {
  const state = await marketRead('getMarket', [id]);
  await sendMarket('trade', [id, curve, state.nonce, state.backing, state.closeAt - 1n], wallet);
  return await marketRead('receiptCount');
}
async function resolve(id, outcome = 0n) {
  const state = await marketRead('getMarket', [id]);
  await advance(state.closeAt);
  await sendMarket('resolve', [id, outcome, keccak256(toBytes('observed evidence'))], wallets[3]);
}
before(async () => {
  artifacts = compile();
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(localRpcUrl).hostname), 'Lifecycle suite is restricted to a disposable local node');
  transport = http(localRpcUrl);
  const probe = createPublicClient({ transport });
  const id = await probe.getChainId();
  assert.equal(id, 5042002, 'Start Arc anvil in Arc runtime mode with chain ID 5042002');
  const chain = defineChain({ id, name: 'Local lifecycle verification', nativeCurrency: { name: 'Test USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1'] } } });
  publicClient = createPublicClient({ chain, transport, pollingInterval: 20, cacheTime: 0 });
  accounts = await rpc('eth_accounts');
  assert.ok(accounts.length >= 4, 'Local node must expose four disposable funded accounts');
  wallets = accounts.map(account => createWalletClient({ account, chain, transport }));
  async function deploy(name, args = []) {
    const hash = await wallets[0].deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, gas: 12_000_000n, gasPrice: 25_000_000_000n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    return receipt.contractAddress;
  }
  token = await deploy('MockUSDC');
  marketContract = await deploy('DistributionMarkets', [token, accounts[0]]);
  harness = await deploy('GaussianHarness');
  assert.ok(artifacts.DistributionMarkets.deployedBytecode.length / 2 - 1 < 24576, 'Contract fits EIP-170');
  for (let i = 0; i < 4; i++) {
    await send(token, 'MockUSDC', 'mint', [accounts[i], 1_000_000_000_000n]);
    await send(token, 'MockUSDC', 'approve', [marketContract, 1_000_000_000_000n], wallets[i]);
  }
  checkpoint = await rpc('evm_snapshot');
  console.log(`Lifecycle runtime: local Arc node; chain ${id}; ${await rpc('web3_clientVersion')}`);
});
beforeEach(async () => { await rpc('evm_revert', [checkpoint]); checkpoint = await rpc('evm_snapshot'); });
after(() => {});

describe('Gaussian parity and input boundaries', () => {
  it('matches every independently generated fixture exactly', async () => {
    const fixture = JSON.parse(fs.readFileSync('reference/fixtures.json', 'utf8'));
    for (const item of fixture.evaluations) {
      const curve = { mean: BigInt(item.curve.mean), sigma: BigInt(item.curve.sigma) };
      const result = await read(harness, 'GaussianHarness', 'evaluate', [curve, BigInt(item.normWad), BigInt(item.backingMicro), BigInt(item.outcome)]);
      assert.equal(result.toString(), item.expectedMicro, item.name);
    }
    console.log(`Solidity parity: ${fixture.evaluations.length} fixtures`);
  });
  it('rejects invalid curves, norm, backing and supported coordinates', async () => {
    const invalid = [
      [{ ...initial, sigma: 0n }, K, B, 0n], [{ ...initial, sigma: 10n ** 15n }, K, B, 0n],
      [{ ...initial, sigma: 101n * WAD }, K, B, 0n], [{ ...initial, mean: 1001n * WAD }, K, B, 0n],
      [initial, 0n, B, 0n], [initial, K, 0n, 0n], [initial, K, 1_000_000_001n, 0n],
      [initial, 1000n * WAD, B, 0n], [initial, K, B, -1001n * WAD],
    ];
    for (const args of invalid) await assert.rejects(read(harness, 'GaussianHarness', 'evaluate', args));
  });
});
describe('Roles, immutable configuration and quotes', () => {
  it('requires the operator and rejects invalid rules, resolver and creation deadlines', async () => {
    const { config } = await create();
    await expectRevert('createMarket', [config, initial], wallets[1]);
    for (const overrides of [{ resolver: zeroAddress }, { rulesHash: `0x${'00'.repeat(32)}` }, { closeAt: await now() }, { resolveBy: config.closeAt }, { scale: 0n }, { minMean: 1n, maxMean: 0n }, { maxSigma: 101n * WAD }, { minOutcome: 1n, maxOutcome: WAD - 1n, outcomeStep: WAD }]) await expectRevert('createMarket', [{ ...config, ...overrides }, initial]);
  });
  it('enforces exact collateral, stale nonces, quote caps, expiry and unchanged curves', async () => {
    const { id, config } = await create();
    const proposal = { mean: WAD, sigma: WAD };
    await expectRevert('trade', [id, initial, 0n, B, config.closeAt], wallets[1]);
    await expectRevert('trade', [id, proposal, 0n, B - 1n, config.closeAt], wallets[1]);
    await expectRevert('trade', [id, proposal, 0n, B, await now() - 1n], wallets[1]);
    const before = await read(token, 'MockUSDC', 'balanceOf', [accounts[1]]);
    await trade(id, proposal);
    assert.equal(before - await read(token, 'MockUSDC', 'balanceOf', [accounts[1]]), B);
    await expectRevert('trade', [id, initial, 0n, B, config.closeAt], wallets[2]);
    assert.equal((await marketRead('getMarket', [id])).nonce, 1n);
    assert.equal(await marketRead('totalLiability'), 2n * B);
  });
  it('rejects insufficient allowance and atomically preserves market and receipt state', async () => {
    const { id } = await create();
    await send(token, 'MockUSDC', 'approve', [marketContract, B - 1n], wallets[1]);
    await expectRevert('trade', [id, { mean: WAD, sigma: WAD }, 0n, B, (await now()) + 500n], wallets[1]);
    assert.equal(await marketRead('receiptCount'), 0n);
    assert.equal((await marketRead('getMarket', [id])).nonce, 0n);
  });
  it('validates range and canonical normalization without overflow', async () => {
    const { id } = await create({ origin: 20n * WAD, scale: 2n * WAD, outcomeStep: WAD / 10n });
    assert.equal(await marketRead('normalizeOutcome', [id, 235n * WAD / 10n]), 18n * WAD / 10n);
    assert.equal(await marketRead('normalizeOutcome', [id, 165n * WAD / 10n]), -18n * WAD / 10n);
    const ties = await create({ scale: 2n * WAD, outcomeStep: 1n });
    assert.equal(await marketRead('normalizeOutcome', [ties.id, 1n]), 1n);
    assert.equal(await marketRead('normalizeOutcome', [ties.id, -1n]), -1n);
    await assert.rejects(marketRead('normalizeOutcome', [id, 1n << 255n]));
    await assert.rejects(marketRead('normalizeOutcome', [id, 3000n * WAD]));
  });
});
describe('Terminal states and recovery', () => {
  it('uses close inclusive / resolveBy exclusive resolution boundaries', async () => {
    const { id, config } = await create();
    const evidence = keccak256(toBytes('evidence'));
    await expectRevert('resolve', [id, 0n, evidence], wallets[3]);
    await expectRevert('resolve', [id, 0n, evidence], wallets[1]);
    await advance(config.closeAt);
    await expectRevert('trade', [id, { mean: WAD, sigma: WAD }, 0n, B, config.resolveBy], wallets[1]);
    await expectRevert('cancelExpired', [id]);
    await sendMarket('resolve', [id, 0n, evidence], wallets[3]);
    await expectRevert('resolve', [id, 0n, evidence], wallets[3]);
    await expectRevert('cancelExpired', [id]);
    const second = await create();
    await advance(second.config.resolveBy);
    await expectRevert('resolve', [second.id, 0n, evidence], wallets[3]);
    await sendMarket('cancelExpired', [second.id], wallets[2]);
    assert.equal((await marketRead('getMarket', [second.id])).status, 2);
  });
  it('requires nonzero evidence, admitted outcome and the committed precision', async () => {
    const { id, config } = await create(); await advance(config.closeAt);
    await expectRevert('resolve', [id, 0n, `0x${'00'.repeat(32)}`], wallets[3]);
    await expectRevert('resolve', [id, 1n, keccak256(toBytes('x'))], wallets[3]);
    await expectRevert('resolve', [id, 1001n * WAD, keccak256(toBytes('x'))], wallets[3]);
  });
  it('returns original deposits after permissionless expiry cancellation', async () => {
    const { id, config } = await create(); const receiptId = await trade(id, { mean: WAD, sigma: 2n * WAD });
    await advance(config.resolveBy); await sendMarket('cancelExpired', [id], wallets[2]);
    assert.equal(await marketRead('previewClaim', [receiptId]), B);
    assert.equal(await marketRead('previewSponsorClaim', [id]), B);
    await sendMarket('claim', [receiptId], wallets[1]); await sendMarket('claimSponsor', [id]);
    assert.equal(await marketRead('totalLiability'), 0n);
  });
  it('conserves integer escrow with two wallets and sponsor claiming first', async () => {
    const { id } = await create();
    const a = await trade(id, { mean: WAD, sigma: 2n * WAD });
    const b = await trade(id, { mean: -WAD, sigma: 4n * WAD }, wallets[2]);
    await resolve(id, WAD);
    const payouts = await Promise.all([marketRead('previewSponsorClaim', [id]), marketRead('previewClaim', [a]), marketRead('previewClaim', [b])]);
    assert.equal(payouts.reduce((sum, value) => sum + value, 0n), 3n * B);
    for (const amount of payouts) assert.ok(amount >= 0n && amount <= 2n * B);
    await sendMarket('claimSponsor', [id]); await sendMarket('claim', [b], wallets[2]); await sendMarket('claim', [a], wallets[1]);
    const state = await marketRead('getMarket', [id]);
    assert.equal(state.deposited, state.paid); assert.equal(await marketRead('totalLiability'), 0n);
    assert.equal(await read(token, 'MockUSDC', 'balanceOf', [marketContract]), 0n);
  });
  it('prevents wrong-owner, duplicate and premature claims', async () => {
    const { id } = await create(); const a = await trade(id, { mean: WAD, sigma: WAD });
    await expectRevert('claim', [a], wallets[1]); await expectRevert('claimSponsor', [id]);
    await resolve(id);
    await expectRevert('claim', [a], wallets[2]); await expectRevert('claimSponsor', [id], wallets[1]);
    await sendMarket('claim', [a], wallets[1]); await expectRevert('claim', [a], wallets[1]);
    await sendMarket('claimSponsor', [id]); await expectRevert('claimSponsor', [id]);
  });
});
describe('Adversarial custody and bounded claims', () => {
  it('preserves rightful claims and liabilities when a token transfer is restricted', async () => {
    const { id } = await create(); const a = await trade(id, { mean: WAD, sigma: WAD }); await resolve(id);
    const liability = await marketRead('totalLiability');
    await send(token, 'MockUSDC', 'setFailTransfers', [true]);
    await expectRevert('claim', [a], wallets[1]);
    assert.equal((await marketRead('getReceipt', [a])).claimed, false);
    assert.equal(await marketRead('totalLiability'), liability);
    await send(token, 'MockUSDC', 'setFailTransfers', [false]); await sendMarket('claim', [a], wallets[1]);
  });
  it('rejects reentrant trading from token callbacks', async () => {
    const { id, config } = await create();
    const reentry = encodeFunctionData({ abi: artifacts.DistributionMarkets.abi, functionName: 'trade', args: [id, { mean: 2n * WAD, sigma: WAD }, 1n, B, config.closeAt] });
    await send(token, 'MockUSDC', 'setCallback', [marketContract, reentry]);
    await trade(id, { mean: WAD, sigma: WAD });
    assert.equal(await read(token, 'MockUSDC', 'callbackSucceeded'), false);
    assert.equal((await read(token, 'MockUSDC', 'callbackResult')).slice(0, 10), keccak256(toBytes('ReentrancyGuardReentrantCall()')).slice(0, 10));
    assert.equal(await marketRead('receiptCount'), 1n);
  });
  it('isolates market liabilities and leaves direct donations outside ownership', async () => {
    const first = await create(); const receiptId = await trade(first.id, { mean: WAD, sigma: WAD });
    const second = await create();
    const donation = 123456n; await send(token, 'MockUSDC', 'transfer', [marketContract, donation]);
    await resolve(first.id); await sendMarket('claim', [receiptId], wallets[1]); await sendMarket('claimSponsor', [first.id]);
    assert.equal(await marketRead('totalLiability'), B);
    assert.equal(await read(token, 'MockUSDC', 'balanceOf', [marketContract]), B + donation);
    assert.equal((await marketRead('getMarket', [second.id])).paid, 0n);
  });
  it('keeps single-claim gas bounded after 50 opposing trades', async () => {
    const { id } = await create();
    let first, late;
    for (let i = 0; i < 50; i++) {
      const receiptId = await trade(id, { mean: 0n, sigma: i % 2 === 0 ? 2n * WAD : WAD }, wallets[1 + i % 2]);
      if (i === 0) first = receiptId; if (i === 48) late = receiptId;
    }
    await resolve(id);
    const early = await sendMarket('claim', [first], wallets[1]);
    const later = await sendMarket('claim', [late], wallets[1]);
    assert.ok(later.gasUsed < 300000n);
    assert.ok(later.gasUsed <= early.gasUsed + 1000n);
    console.log(`Bounded claim gas: ${early.gasUsed}/${later.gasUsed} after 50 trades`);
  });
});

describe('Arc native USDC escrow integration', () => {
  it('executes native USDC funding, two traders, resolution/claims and expiry/refunds', async () => {
    const mockToken = token, mockMarket = marketContract;
    token = '0x3600000000000000000000000000000000000000';
    try {
      assert.equal(await read(token, 'MockUSDC', 'decimals'), 6);
      const hash = await wallets[0].deployContract({ abi: artifacts.DistributionMarkets.abi, bytecode: artifacts.DistributionMarkets.bytecode, args: [token, accounts[0]], gas: 12_000_000n, gasPrice: 25_000_000_000n });
      const deployed = await publicClient.waitForTransactionReceipt({ hash }); assert.equal(deployed.status, 'success'); marketContract = deployed.contractAddress;
      for (let i = 0; i < 3; i++) await send(token, 'MockUSDC', 'approve', [marketContract, B], wallets[i]);
      const resolved = await create();
      const a = await trade(resolved.id, { mean: WAD, sigma: 2n * WAD });
      const b = await trade(resolved.id, { mean: -WAD, sigma: 4n * WAD }, wallets[2]);
      for (let i = 0; i < 3; i++) assert.equal(await read(token, 'MockUSDC', 'allowance', [accounts[i], marketContract]), 0n);
      assert.equal(await read(token, 'MockUSDC', 'balanceOf', [marketContract]), 3n * B);
      assert.equal(await publicClient.getBalance({ address: marketContract }) / 10n ** 12n, 3n * B);
      await resolve(resolved.id);
      await sendMarket('claim', [b], wallets[2]); await sendMarket('claimSponsor', [resolved.id]); await sendMarket('claim', [a], wallets[1]);
      assert.equal(await marketRead('totalLiability'), 0n);
      assert.equal(await read(token, 'MockUSDC', 'balanceOf', [marketContract]), 0n);
      for (let i = 0; i < 2; i++) await send(token, 'MockUSDC', 'approve', [marketContract, B], wallets[i]);
      const expired = await create(); const receiptId = await trade(expired.id, { mean: WAD, sigma: WAD });
      await advance(expired.config.resolveBy); await sendMarket('cancelExpired', [expired.id], wallets[2]);
      assert.equal(await marketRead('previewClaim', [receiptId]), B);
      await sendMarket('claimSponsor', [expired.id]); await sendMarket('claim', [receiptId], wallets[1]);
      assert.equal(await marketRead('totalLiability'), 0n);
      assert.equal(await read(token, 'MockUSDC', 'balanceOf', [marketContract]), 0n);
    } finally { token = mockToken; marketContract = mockMarket; }
  });
});
