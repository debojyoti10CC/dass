import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toBytes } from 'viem';
import { canonical } from '../scripts/public-runtime.mjs';
import { btcOraclePolicy, collectOracleHealth, evaluateOracleHealth, sha256 } from '../scripts/oracle-health.mjs';
import { resolveCoinbase } from '../scripts/resolve-coinbase.mjs';

const bucket = 1800000000, WAD = 10n ** 18n;
const policy = btcOraclePolicy(bucket);
const timestamp = new Date((bucket + 150) * 1000);
function body(id, price = '100', t = bucket) {
  if (id === 'coinbase') return [[t, 99, 101, 100, Number(price), 10]];
  if (id === 'bitstamp') return { data: { pair: 'BTC/USD', ohlc: [{ timestamp: String(t), close: price }] } };
  return { error: [], result: { XXBTZUSD: [[t, '100', '101', '99', price, '100', '10', 10]], last: t + 60 } };
}
function fetcher(overrides = {}) {
  return async url => {
    const id = policy.sources.find(source => source.url === url)?.id;
    assert.ok(id, 'Only committed source URLs may be fetched');
    if (overrides[id] instanceof Error) throw overrides[id];
    return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify(overrides[id] ?? body(id))) };
  };
}
const collect = (overrides, now = timestamp) => collectOracleHealth(policy, bucket, { fetchImpl: fetcher(overrides), now: () => now });

test('three agreeing completed candles are healthy; Coinbase is the settlement value', async () => {
  const health = await collect({ bitstamp: body('bitstamp', '100.5'), kraken: body('kraken', '101') });
  assert.equal(health.healthy, true); assert.equal(health.rawValue, '100');
});
test('source failure, stale/missing/duplicate candle and incomplete retrieval block health', async () => {
  for (const bad of [new Error('timeout'), body('kraken', '100', bucket - 60), { error: ['rate limited'] }, { error: [], result: { XXBTZUSD: [body('kraken').result.XXBTZUSD[0], body('kraken').result.XXBTZUSD[0]] } }]) {
    assert.equal((await collect({ kraken: bad })).healthy, false);
  }
  for (const seconds of [bucket + 59, bucket + 119, bucket + 361]) assert.equal((await collect({}, new Date(seconds * 1000))).healthy, false);
});
test('one outlier blocks instead of silently using the other two', async () => {
  assert.equal((await collect({ kraken: body('kraken', '101.000000000000000001') })).healthy, false);
  assert.equal((await collect({ coinbase: body('coinbase', '130') })).healthy, false);
});
test('duplicate sources, changed tolerance, tampered archives and price claims are rejected', async () => {
  const health = await collect();
  assert.throws(() => evaluateOracleHealth({ ...policy, requiredSources: 2 }, bucket, health.observations), /policy/);
  for (const field of ['id', 'url', 'sourceSha256', 'sourceBytes', 'rawValue']) {
    const observations = structuredClone(health.observations); observations[1][field] = 'tampered';
    assert.throws(() => evaluateOracleHealth(policy, bucket, observations));
  }
});

function fixture({ healthPolicy = false, cached = false } = {}) {
  const rules = { category: 'Crypto', source: policy.sources[0].url, bucketStart: bucket, earliestRetrievalAt: new Date((bucket + 120) * 1000).toISOString(), field: 'close', observationAt: new Date((bucket + 60) * 1000).toISOString(), publicationPolicy: 'first complete observation', units: 'USD', precision: 'micro', rounding: 'nearest', normalization: { origin: '0', scale: '1' }, ...(healthPolicy ? { oracleHealth: policy } : {}) };
  const manifest = { address: '0xcontract', chainId: 5042002 };
  const market = { rulesHash: keccak256(toBytes(JSON.stringify(canonical(rules)))), resolver: '0xresolver', status: 0, closeAt: BigInt(bucket), resolveBy: BigInt(bucket + 3600) };
  const sourceBytes = Buffer.from(JSON.stringify(body('coinbase')));
  const evidence = { schemaVersion: 1, chainId: manifest.chainId, contract: manifest.address, marketId: '1', rulesHash: market.rulesHash, resolver: market.resolver, sourceArchive: './source.json', sourceSha256: sha256(sourceBytes), rawValue: '100', normalizedOutcome: String(100n * WAD), originalObservation: JSON.stringify(body('coinbase')[0]), publicationAt: timestamp.toISOString(), ...Object.fromEntries(['source','field','observationAt','publicationPolicy','units','precision','rounding','normalization'].map(key => [key, rules[key]])) };
  const files = new Map([['deployments/arc-testnet-real-markets.json', JSON.stringify({ markets: [{ marketId: '1', slug: 'test', rules }] })]]);
  const path = 'web/public/evidence/arc-testnet-test/evidence.json';
  if (cached) { files.set(path, JSON.stringify(evidence)); files.set(path.replace('evidence.json','source.json'), sourceBytes); }
  const calls = [];
  const runtime = { manifest, account: { address: market.resolver }, abi: [], client: { getBlock: async () => ({ timestamp: BigInt(bucket + 150) }), readContract: async ({ functionName, args }) => functionName === 'getMarket' ? market : args[1] }, call: async (...args) => { calls.push(args); return { transactionHash: '0xtest', blockNumber: 1n }; } };
  const fileSystem = { existsSync: p => files.has(p), readFileSync: p => { assert.ok(files.has(p), `Missing ${p}`); return files.get(p); }, mkdirSync: () => {}, writeFileSync: (p,v) => files.set(p,v) };
  return { rules, market, evidence, files, path, calls, options: { runtime, fileSystem, fetchImpl: fetcher(), clock: () => timestamp } };
}
test('fresh three-source resolution submits only after health and exact normalization validation', async () => {
  const f = fixture({ healthPolicy: true }); await resolveCoinbase(f.options);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][4][1], 100n * WAD);
  const archived = JSON.parse(f.files.get(f.path)); assert.equal(archived.oracleHealth.observations.length, 3);
  f.calls.length = 0;
  await resolveCoinbase({ ...f.options, fetchImpl: async () => { throw new Error('Must use pinned archived observation'); } });
  assert.equal(f.calls.length, 1);
});
test('unhealthy sources prevent signing and archive a diagnostic report', async () => {
  const f = fixture({ healthPolicy: true });
  await assert.rejects(resolveCoinbase({ ...f.options, fetchImpl: fetcher({ kraken: new Error('offline') }) }), /blocked signing/);
  assert.equal(f.calls.length, 0); assert.ok(f.files.has('work/arc-testnet-test-oracle-health.json'));
});
test('cached evidence tampering is rejected before signing, including recomputed normalization', async () => {
  for (const [field, value] of [['rawValue','999'], ['normalizedOutcome','1'], ['sourceSha256','bad'], ['rulesHash','wrong'], ['marketId','2'], ['contract','other'], ['resolver','other'], ['source','other'], ['precision','other'], ['normalization',{origin:'0',scale:'2'}], ['publicationAt',new Date((bucket+59)*1000).toISOString()], ['publicationAt',new Date((bucket+3600)*1000).toISOString()], ['publicationAt',new Date((bucket+151)*1000).toISOString()]]) {
    const f = fixture({ cached: true }); f.files.set(f.path, JSON.stringify({ ...f.evidence, [field]: value }));
    await assert.rejects(resolveCoinbase(f.options), undefined, field); assert.equal(f.calls.length, 0, field);
  }
  const f = fixture({ cached: true }); f.files.set(f.path.replace('evidence.json','source.json'), Buffer.from('[]'));
  await assert.rejects(resolveCoinbase(f.options), /sourceSha256/); assert.equal(f.calls.length, 0);
});
test('legacy committed single-source rules keep their semantics and resolved verification never signs', async () => {
  const f = fixture({ cached: true }); await resolveCoinbase(f.options); assert.equal(f.calls.length, 1);
  f.calls.length = 0; f.market.status = 1; f.market.outcome = 100n * WAD; f.market.evidenceHash = keccak256(toBytes(f.files.get(f.path)));
  await resolveCoinbase(f.options); assert.equal(f.calls.length, 0);
  f.market.outcome = WAD; await assert.rejects(resolveCoinbase(f.options), /disagree/);
});

test('cached three-source health cannot be dropped or tampered to bypass signing', async () => {
  for (const mutate of [doc => delete doc.oracleHealth, doc => doc.oracleHealth.observations[1].rawValue = '999', doc => doc.oracleHealth.observations[2].retrievedAt = new Date((bucket + 151) * 1000).toISOString()]) {
    const f = fixture({ healthPolicy: true }); await resolveCoinbase(f.options); f.calls.length = 0;
    const doc = JSON.parse(f.files.get(f.path)); mutate(doc); f.files.set(f.path, JSON.stringify(doc));
    await assert.rejects(resolveCoinbase(f.options)); assert.equal(f.calls.length, 0);
  }
});
test('cancelled and expired markets cannot sign from a valid cache', async () => {
  const cancelled = fixture({ cached: true }); cancelled.market.status = 2;
  await assert.rejects(resolveCoinbase(cancelled.options), /Cancelled/); assert.equal(cancelled.calls.length, 0);
  const expired = fixture({ cached: true }); expired.options.runtime.client.getBlock = async () => ({ timestamp: expired.market.resolveBy });
  await assert.rejects(resolveCoinbase(expired.options), /Outside resolution/); assert.equal(expired.calls.length, 0);
});
