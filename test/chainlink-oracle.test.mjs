import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toBytes } from 'viem';
import { chainlinkPolicy, chainlinkSource, chainlinkClient, observationBlock, readChainlink } from '../scripts/chainlink-oracle.mjs';
import { canonical } from '../scripts/public-runtime.mjs';
import { resolveCoinbase } from '../scripts/resolve-coinbase.mjs';

const target = 1800000060;
const policy = { version: 1, type: 'chainlink-btc-usd', chainId: 5042002, address: '0x1111111111111111111111111111111111111111', decimals: 8, maxAgeSeconds: 86400 };
function fixture() {
  const round = [7n, 10012345678n, BigInt(target - 30), BigInt(target - 20), 7n];
  const blocks = Array.from({ length: 11 }, (_, i) => ({ number: BigInt(i), timestamp: BigInt(target - 10 + i * 2), hash: `0x${String(i).padStart(64, '0')}` }));
  const client = {
    getChainId: async () => policy.chainId,
    getBlock: async ({ blockNumber } = {}) => blocks[Number(blockNumber ?? 10n)],
    readContract: async ({ functionName, blockNumber }) => {
      assert.equal(blockNumber, 5n);
      return functionName === 'decimals' ? 8 : functionName === 'description' ? 'BTC / USD' : round;
    },
  };
  return { round, blocks, client };
}

test('testnet explicitly reads the published mainnet feed and binds its settlement chain', () => {
  const configured = chainlinkPolicy('arc-testnet');
  assert.equal(configured.chainId, 5042);
  assert.equal(configured.settlementChainId, 5042002);
  assert.equal(configured.address, chainlinkPolicy('arc-mainnet').address);
  assert.throws(() => chainlinkClient(configured, {}, 5042), /settlement chain mismatch/);
  assert.throws(() => chainlinkClient({ ...configured, settlementChainId: 1 }, {}, 1), /Unsupported/);
  assert.throws(() => chainlinkPolicy('missing-network'), /verified Chainlink/);
  const client = {};
  assert.equal(chainlinkClient(policy, client, 5042002), client);
  assert.equal(chainlinkPolicy('arc-mainnet').address, '0xa109B535C70C8Be9995be64Bb6751AcDB27e03De');
});

test('selects the first block at/after target and preserves exact decimal price', async () => {
  const f = fixture();
  const block = await observationBlock(f.client, target);
  assert.equal(block.number, 5n);
  assert.equal((await readChainlink(f.client, policy, block, target)).rawValue, '100.12345678');
  await assert.rejects(observationBlock(f.client, target + 11), /not arrived/);
  await assert.rejects(readChainlink(f.client, policy, f.blocks[4], target));
});

test('wrong network/feed/decimals, nonpositive/stale/future/incomplete rounds never pass', async () => {
  for (const mutate of [
    f => f.client.getChainId = async () => 1,
    f => { const read = f.client.readContract; f.client.readContract = args => args.functionName === 'description' ? 'ETH / USD' : read(args); },
    f => { const read = f.client.readContract; f.client.readContract = args => args.functionName === 'decimals' ? 18 : read(args); },
    f => f.round[1] = 0n,
    f => f.round[1] = -1n,
    f => { f.round[2] = BigInt(target - 86402); f.round[3] = BigInt(target - 86401); },
    f => f.round[3] = BigInt(target + 1),
    f => f.round[4] = 6n,
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(readChainlink(f.client, policy, f.blocks[5], target));
  }
});

function resolutionFixture({ crossChain = false } = {}) {
  const f = fixture();
  const marketPolicy = crossChain ? { ...policy, chainId: 5042, settlementChainId: 5042002 } : policy;
  const rules = { category: 'Crypto', chainlink: marketPolicy, source: chainlinkSource(marketPolicy), observationAt: new Date(target * 1000).toISOString(), earliestRetrievalAt: new Date(target * 1000).toISOString(), field: 'answer', publicationPolicy: 'first target block', units: 'USD', precision: '8', rounding: 'nearest', normalization: { origin: '0', scale: '1' } };
  const manifest = { chainId: policy.chainId, address: '0xcontract' };
  const market = { status: 0, resolver: '0xresolver', closeAt: BigInt(target - 60), resolveBy: BigInt(target + 3600), rulesHash: keccak256(toBytes(JSON.stringify(canonical(rules)))) };
  const files = new Map([['deployments/arc-testnet-real-markets.json', JSON.stringify({ markets: [{ marketId: '1', slug: 'chainlink-test', rules }] })]]);
  const path = 'web/public/evidence/arc-testnet-chainlink-test/evidence.json';
  const calls = [], read = f.client.readContract;
  const oracleClient = crossChain ? { ...f.client, getChainId: async () => 5042 } : f.client;
  f.client.readContract = args => {
    if (args.functionName === 'getMarket') return market;
    if (args.functionName === 'normalizeOutcome') return args.args[1];
    assert.equal(crossChain, false, 'Mainnet feed must never be read on testnet');
    return read(args);
  };
  const fileSystem = { existsSync: p => files.has(p), readFileSync: p => { assert.ok(files.has(p)); return files.get(p); }, mkdirSync: () => {}, writeFileSync: (p, v) => files.set(p, v) };
  const runtime = { manifest, account: { address: market.resolver }, client: f.client, abi: [], call: async (...args) => { calls.push(args); return { transactionHash: '0xtest', blockNumber: 1n }; } };
  return { ...f, market, files, path, calls, oracleClient, options: { runtime, fileSystem, ...(crossChain ? { oracleClient } : {}), clock: () => new Date((target + 10) * 1000), fetchImpl: () => { throw new Error('No exchange calls allowed'); } } };
}

test('mainnet source round settles on testnet; cached evidence preserves both chain identities', async () => {
  const f = resolutionFixture({ crossChain: true });
  await resolveCoinbase(f.options);
  assert.equal(f.calls.length, 1);
  const evidence = JSON.parse(f.files.get(f.path));
  const source = JSON.parse(f.files.get(f.path.replace('evidence.json', 'source.json')));
  assert.equal(evidence.chainId, 5042002);
  assert.equal(source.chainId, 5042);
  assert.match(evidence.source, /^https:\/\/explorer\.arc\.io\//);
  f.calls.length = 0;
  await resolveCoinbase(f.options);
  assert.equal(f.calls.length, 1);
});

test('cross-chain source outage, wrong source chain and wrong settlement chain block signing', async () => {
  for (const mutate of [
    f => f.oracleClient.getChainId = async () => 5042002,
    f => f.oracleClient.readContract = async () => { throw new Error('Source RPC unavailable'); },
    f => f.client.getChainId = async () => 5042,
  ]) {
    const f = resolutionFixture({ crossChain: true });
    await resolveCoinbase(f.options); f.calls.length = 0; mutate(f);
    await assert.rejects(resolveCoinbase(f.options));
    assert.equal(f.calls.length, 0);
  }
});

test('fresh and cached Chainlink settlement verify onchain and resolved retry never signs', async () => {
  const f = resolutionFixture();
  await resolveCoinbase(f.options);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][4][1], 100123456780000000000n);
  f.calls.length = 0;
  await resolveCoinbase(f.options);
  assert.equal(f.calls.length, 1);
  f.calls.length = 0;
  f.market.status = 1; f.market.outcome = 100123456780000000000n;
  f.market.evidenceHash = keccak256(toBytes(f.files.get(f.path)));
  await resolveCoinbase(f.options);
  assert.equal(f.calls.length, 0);
});

test('cached price tampering, changed onchain round, unavailable history and deadlines block signing', async () => {
  for (const mutate of [
    f => { const doc = JSON.parse(f.files.get(f.path)); doc.rawValue = '999'; f.files.set(f.path, JSON.stringify(doc)); },
    f => f.round[1] += 1n,
    f => f.blocks[5].hash = '0xchanged',
    f => f.client.readContract = async () => { throw new Error('Historical state unavailable'); },
    f => f.market.status = 2,
    f => f.blocks[10].timestamp = f.market.resolveBy,
  ]) {
    const f = resolutionFixture(); await resolveCoinbase(f.options); f.calls.length = 0; mutate(f);
    await assert.rejects(resolveCoinbase(f.options));
    assert.equal(f.calls.length, 0);
  }
});
