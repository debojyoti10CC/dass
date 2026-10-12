import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toBytes } from 'viem';
import { chainlinkSource, readChainlink, validateBtcDirectionObservation } from '../scripts/chainlink-oracle.mjs';
import { canonical } from '../scripts/public-runtime.mjs';
import { resolveCoinbase } from '../scripts/resolve-coinbase.mjs';

const start = 1800000000;
const policy = { version: 1, type: 'chainlink-btc-usd', chainId: 5042002, address: '0x1111111111111111111111111111111111111111', decimals: 8, maxAgeSeconds: 86400 };
const iso = value => new Date(value * 1000).toISOString();

function fixture({ startPrice = 10000n, endPrice = 10000n } = {}) {
  const blocks = [start - 2, start, start + 10, start + 298, start + 300, start + 310, start + 320].map((timestamp, i) => ({ number: BigInt(i), timestamp: BigInt(timestamp), hash: `0x${String(i + 1).padStart(64, '0')}` }));
  const client = {
    getChainId: async () => policy.chainId,
    getBlock: async ({ blockNumber } = {}) => blocks[Number(blockNumber ?? 6n)],
    readContract: async ({ functionName, blockNumber }) => {
      if (functionName === 'decimals') return 8;
      if (functionName === 'description') return 'BTC / USD';
      const answer = Number(blockNumber) < 4 ? startPrice : endPrice;
      const updatedAt = blocks[Number(blockNumber)].timestamp - 1n;
      return [BigInt(blockNumber) + 1n, answer, updatedAt - 1n, updatedAt, BigInt(blockNumber) + 1n];
    },
  };
  const rules = {
    kind: 'btc-five-minute-direction', chainlink: policy, source: chainlinkSource(policy), windowStart: iso(start), windowEnd: iso(start + 300), observationAt: iso(start + 300), normalization: { origin: '0', scale: '1' },
    earliestRetrievalAt: iso(start + 300), tiePolicy: 'Up when end price is equal to or greater than start price; Down only when lower.',
    binaryOutcomes: [{ outcome: 'Down', value: '0' }, { outcome: 'Up', value: '1' }],
  };
  const wad = 10n ** 18n;
  return { client, rules, manifest: { chainId: policy.chainId }, market: { closeAt: BigInt(start), resolveBy: BigInt(start + 3900), origin: 0n, scale: wad, outcomeStep: wad, minOutcome: 0n, maxOutcome: wad, minMean: 0n, maxMean: wad, minSigma: wad / 2n, maxSigma: wad / 2n } };
}

async function archived(f) {
  const sample = async (target) => readChainlink(f.client, policy, await f.client.getBlock({ blockNumber: target === start ? 1n : 4n }), target);
  const [a, b] = await Promise.all([sample(start), sample(start + 300)]);
  return Buffer.from(JSON.stringify(canonical({ start: a.snapshot, end: b.snapshot })));
}

test('BTC window resolves Up on a tie and Down only when end answer is lower', async () => {
  for (const [endPrice, expected] of [[10000n, 1n], [9999n, 0n], [10001n, 1n]]) {
    const f = fixture({ endPrice });
    assert.equal(await validateBtcDirectionObservation(f.client, f.rules, await archived(f), f.manifest, f.market), expected);
  }
});

test('BTC direction rejects non-five-minute rules and tampered historical observations', async () => {
  const f = fixture(), source = await archived(f);
  await assert.rejects(validateBtcDirectionObservation(f.client, { ...f.rules, windowEnd: iso(start + 301) }, source, f.manifest, f.market), /rules\/window/);
  await assert.rejects(validateBtcDirectionObservation(f.client, f.rules, source, f.manifest, { ...f.market, outcomeStep: 1n }), /binary market configuration/);
  const changed = JSON.parse(source); changed.end.round[1] = '1';
  await assert.rejects(validateBtcDirectionObservation(f.client, f.rules, Buffer.from(JSON.stringify(changed)), f.manifest, f.market), /disagrees/);
  const later = JSON.parse(source); later.start.blockNumber = '2';
  await assert.rejects(validateBtcDirectionObservation(f.client, f.rules, Buffer.from(JSON.stringify(later)), f.manifest, f.market), /first block/);
});

test('resolver archives both rounds, submits binary Up, and rechecks the cache before any retry', async () => {
  const f = fixture();
  const market = { ...f.market, rulesHash: keccak256(toBytes(JSON.stringify(canonical(f.rules)))), resolver: '0xresolver', status: 0 };
  const saved = new Map([['catalog.json', JSON.stringify({ markets: [{ slug: 'btc-up-down-test', marketId: '1', closeAt: start, resolveBy: start + 3900, rules: f.rules }] })]]);
  const calls = [];
  const read = f.client.readContract;
  f.client.readContract = args => args.functionName === 'getMarket' ? market : args.functionName === 'normalizeOutcome' ? args.args[1] : read(args);
  const runtime = { manifest: { address: '0xcontract', chainId: policy.chainId }, account: { address: '0xresolver' }, client: f.client, abi: [], call: async (...args) => { calls.push(args); return { transactionHash: '0xtest', blockNumber: 1n }; } };
  const fileSystem = { existsSync: path => saved.has(path), readFileSync: path => { assert.ok(saved.has(path)); return saved.get(path); }, mkdirSync: () => {}, writeFileSync: (path, value) => saved.set(path, value) };
  const options = { runtime, fileSystem, oracleClient: f.client, catalogFile: 'catalog.json', resolutionFile: 'resolution.json', clock: () => new Date((start + 321) * 1000) };
  await resolveCoinbase(options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][4][1], 10n ** 18n);
  const evidencePath = 'web/public/evidence/arc-testnet-btc-up-down-test/evidence.json';
  const evidence = JSON.parse(saved.get(evidencePath));
  assert.equal(evidence.rawValue, '1');
  assert.equal(evidence.windowEnd, iso(start + 300));
  saved.set(evidencePath.replace('evidence.json', 'source.json'), Buffer.from('{"start":{},"end":{}}'));
  await assert.rejects(resolveCoinbase(options), /sourceSha256/);
  assert.equal(calls.length, 1);
});
