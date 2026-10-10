import { createHash } from 'node:crypto';
import { parseUnits } from 'viem';
import { canonical } from './public-runtime.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const requireEqual = (a, b, field) => { if (!same(a, b)) throw new Error(`Evidence ${field} mismatch.`); };
const positiveDecimal = value => {
  const text = String(value);
  if (!/^\d{1,20}(\.\d{1,18})?$/.test(text) || parseUnits(text, 18) <= 0n) throw new Error('Invalid positive decimal price.');
  return text;
};

export function btcOraclePolicy(bucket) {
  if (!Number.isSafeInteger(bucket) || bucket < 0 || bucket % 60 !== 0) throw new Error('Expected minute-aligned bucket.');
  const iso = t => new Date(t * 1000).toISOString();
  return {
    version: 1, requiredSources: 3, maxSpreadBps: 100, maxRetrievalDelaySeconds: 300, settlement: 'coinbase',
    sources: [
      { id: 'coinbase', url: `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${iso(bucket)}&end=${iso(bucket + 60)}` },
      { id: 'bitstamp', url: `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=60&limit=2&end=${bucket + 60}&exclude_current_candle=true` },
      { id: 'kraken', url: `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1&since=${bucket}` },
    ],
  };
}

function validatePolicy(policy, bucket) {
  // Only this versioned BTC/USD policy is supported; URLs and independence cannot be overridden.
  requireEqual(policy, btcOraclePolicy(bucket), 'oracleHealth policy');
}

export function readCandle(id, bytes, bucket) {
  const data = JSON.parse(Buffer.from(bytes).toString('utf8'));
  let rows, timestamp, close;
  if (id === 'coinbase') {
    if (!Array.isArray(data)) throw new Error('Invalid Coinbase response.');
    rows = data.filter(row => Array.isArray(row) && row[0] === bucket);
    if (rows.length !== 1 || rows[0].length !== 6 || rows[0].some(value => !Number.isFinite(value))) throw new Error('Exactly one finite Coinbase candle is required.');
    timestamp = rows[0][0]; close = rows[0][4];
  } else if (id === 'bitstamp') {
    if (data.data?.pair !== 'BTC/USD' && data.data?.market !== 'BTC/USD') throw new Error('Bitstamp pair mismatch.');
    if (!Array.isArray(data.data?.ohlc)) throw new Error('Invalid Bitstamp response.');
    rows = data.data.ohlc.filter(row => row?.timestamp === String(bucket));
    if (rows.length !== 1) throw new Error('Exactly one Bitstamp candle is required.');
    timestamp = Number(rows[0].timestamp); close = rows[0].close;
  } else if (id === 'kraken') {
    if (!Array.isArray(data.error) || data.error.length || !Array.isArray(data.result?.XXBTZUSD)) throw new Error('Invalid Kraken BTC/USD response.');
    rows = data.result.XXBTZUSD.filter(row => Array.isArray(row) && row[0] === bucket);
    if (rows.length !== 1 || rows[0].length !== 8) throw new Error('Exactly one Kraken candle is required.');
    timestamp = rows[0][0]; close = rows[0][4];
  } else throw new Error('Unsupported oracle source.');
  return { timestamp, rawValue: positiveDecimal(close), originalObservation: JSON.stringify(rows[0]) };
}

export function evaluateOracleHealth(policy, bucket, observations) {
  validatePolicy(policy, bucket);
  if (!Array.isArray(observations) || observations.length !== 3) throw new Error('Three source observations required.');
  for (let i = 0; i < 3; i++) {
    const expected = policy.sources[i], observation = observations[i];
    requireEqual(observation.id, expected.id, 'oracle id');
    requireEqual(observation.url, expected.url, 'oracle URL');
    const time = Date.parse(observation.retrievedAt) / 1000;
    if (!Number.isFinite(time) || time < bucket + 120 || time > bucket + 60 + policy.maxRetrievalDelaySeconds) throw new Error(`${expected.id}: incomplete or stale retrieval.`);
    const bytes = Buffer.from(observation.sourceBytes, 'base64');
    if (bytes.toString('base64') !== observation.sourceBytes || sha256(bytes) !== observation.sourceSha256) throw new Error(`${expected.id}: archived source integrity mismatch.`);
    const candle = readCandle(expected.id, bytes, bucket);
    requireEqual(observation.rawValue, candle.rawValue, 'oracle rawValue');
  }
  const prices = observations.map(item => parseUnits(item.rawValue, 18)).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  const healthy = (prices[2] - prices[0]) * 10000n <= prices[0] * BigInt(policy.maxSpreadBps);
  return { healthy, reason: healthy ? 'All three completed BTC/USD candles agree.' : 'Source price spread exceeds the committed limit.', rawValue: observations[0].rawValue, observations };
}

export async function collectOracleHealth(policy, bucket, { fetchImpl = fetch, now = () => new Date() } = {}) {
  validatePolicy(policy, bucket);
  const results = await Promise.allSettled(policy.sources.map(async source => {
    const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const candle = readCandle(source.id, bytes, bucket);
    return { ...source, rawValue: candle.rawValue, retrievedAt: now().toISOString(), sourceSha256: sha256(bytes), sourceBytes: bytes.toString('base64') };
  }));
  const observations = results.map((result, i) => result.status === 'fulfilled' ? result.value : { ...policy.sources[i], error: result.reason.message });
  if (results.some(result => result.status === 'rejected')) return { healthy: false, reason: 'One or more oracle sources unavailable or malformed.', observations };
  try { return evaluateOracleHealth(policy, bucket, observations); }
  catch (error) { return { healthy: false, reason: error.message, observations }; }
}

export async function validateSettlementEvidence({ evidence, sourceBytes, rules, market, manifest, marketId, normalize, nowMs = Date.now() }) {
  if (!evidence || typeof evidence !== 'object') throw new Error('Invalid evidence document.');
  const expected = { schemaVersion: 1, chainId: manifest.chainId, contract: manifest.address, marketId: String(marketId), rulesHash: market.rulesHash, resolver: market.resolver, sourceArchive: './source.json' };
  for (const [field, value] of Object.entries(expected)) requireEqual(evidence[field], value, field);
  for (const field of ['source', 'field', 'observationAt', 'publicationPolicy', 'units', 'precision', 'rounding', 'normalization']) requireEqual(evidence[field], rules[field], field);
  requireEqual(evidence.sourceSha256, sha256(sourceBytes), 'sourceSha256');
  const candle = readCandle('coinbase', sourceBytes, rules.bucketStart);
  requireEqual(evidence.rawValue, candle.rawValue, 'rawValue');
  requireEqual(evidence.originalObservation, candle.originalObservation, 'originalObservation');
  const publication = Date.parse(evidence.publicationAt), earliest = Date.parse(rules.earliestRetrievalAt);
  if (!Number.isFinite(publication) || !Number.isFinite(earliest) || earliest < (rules.bucketStart + 60) * 1000 || publication < earliest || publication >= Number(market.resolveBy) * 1000) throw new Error('Evidence retrieval outside the admissible window.');
  const normalized = await normalize(parseUnits(candle.rawValue, 18));
  requireEqual(evidence.normalizedOutcome, normalized.toString(), 'normalizedOutcome');
  if (publication > nowMs) throw new Error('Evidence retrieval is in the future.');
  if (rules.oracleHealth) {
    requireEqual(rules.source, rules.oracleHealth.sources?.[0]?.url, 'primary source URL');
    const health = evaluateOracleHealth(rules.oracleHealth, rules.bucketStart, evidence.oracleHealth?.observations);
    if (!health.healthy) throw new Error(health.reason);
    for (const observation of health.observations) {
      const retrieved = Date.parse(observation.retrievedAt);
      if (retrieved > nowMs || retrieved >= Number(market.resolveBy) * 1000) throw new Error('Oracle retrieval outside the resolution window.');
    }
    const primary = health.observations[0];
    requireEqual(primary.sourceSha256, evidence.sourceSha256, 'primary oracle archive');
    requireEqual(primary.retrievedAt, evidence.publicationAt, 'primary retrieval time');
    requireEqual(health.rawValue, candle.rawValue, 'primary oracle price');
  }
  return normalized;
}
