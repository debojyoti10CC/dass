import fs from 'node:fs';
import { decodeEventLog, keccak256, toBytes, parseUnits } from 'viem';
import { publicRuntime, canonical } from './public-runtime.mjs';
import { assertMainnetReleaseGate } from './release-gate.mjs';

const network = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'arc-testnet';
if (network === 'arc-mainnet') assertMainnetReleaseGate();
const { manifest, account, client, abi, call, tokenAbi, journal } = publicRuntime(network);
const file = `deployments/${network}-real-markets.json`, WAD = 10n ** 18n;
let catalog = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
if (catalog && catalog.contract.toLowerCase() !== manifest.address.toLowerCase()) throw new Error('Catalog belongs to another contract.');
if (!catalog) {
  const timestamp = Number((await client.getBlock()).timestamp);
  const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker');
  if (!response.ok) throw new Error('Coinbase ticker unavailable; no fabricated prior will be used.');
  const ticker = await response.json();
  if (!/^\d+(\.\d+)?$/.test(ticker.price) || Math.abs(Date.parse(ticker.time) / 1000 - timestamp) > 120) throw new Error('Coinbase ticker is stale or invalid.');
  const bucket = (Math.floor(timestamp / 60) + 15) * 60;
  const iso = seconds => new Date(seconds * 1000).toISOString();
  const coinbaseSource = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${iso(bucket)}&end=${iso(bucket + 60)}`;
  const common = { rounding: 'Normalize once, then round to the nearest outcomeStep. Exact halves round away from zero.', evidencePolicy: 'Archive exact original source bytes and SHA256, retrieval UTC time, selected record, raw decimal value, normalized WAD and canonical evidence JSON. Commit the keccak256 of that JSON. A hash proves integrity, not correctness.', initialForecastPolicy: 'The initial curve is a sponsor forecast, not bookmaker odds or an externally supplied probability. Every later curve is read from confirmed onchain state.' };
  const cryptoRules = { ...common, question: `BTC/USD close · ${iso(bucket + 60).slice(0, 16).replace('T', ' ')} UTC`, category: 'Crypto', source: coinbaseSource, field: `close (array index 4) of the unique candle whose time (index 0) equals ${bucket}`, observationAt: iso(bucket + 60), publicationPolicy: `Use the first valid complete Coinbase Exchange BTC-USD 60-second candle retrieved at or after ${iso(bucket + 120)}. Filter by exact bucket timestamp ${bucket}; never substitute the first array item. Later revisions do not apply.`, units: 'USD / 1000', normalization: { origin: '0', scale: '1000' }, precision: 'Raw USD as published; normalized outcomeStep 0.000001 (0.001 USD).', missingData: 'No exact completed candle, malformed/duplicate records, out-of-bounds value or source unavailable through resolveBy means no resolution. Anyone can cancel at expiry for original-deposit refunds.', bucketStart: bucket, granularity: 60, earliestRetrievalAt: iso(bucket + 120), resolverModel: 'Trusted project operator verifies and reports the source. No automated oracle network is claimed.' };
  const football = (slug, home, away, close, week) => ({ slug, closeAt: Math.floor(Date.parse(close) / 1000), resolveBy: Math.floor(Date.parse(close) / 1000) + 48 * 3600, initialMean: '2.8', initialSigma: '1.7', limits: { minMean: '0', maxMean: '30', minOutcome: '0', maxOutcome: '30', outcomeStep: '1' }, rules: { ...common, question: `${home} vs ${away} · total goals`, category: 'Football', source: `https://www.premierleague.com/en/matches/premier-league/2026-27/matchweek-${week}`, field: `home full-time goals + away full-time goals for ${home} (home) vs ${away} (away), Premier League 2026/27`, observationAt: close, publicationPolicy: 'Use the first official Premier League FT result for this exact fixture completed after the committed closeAt. Count regulation and stoppage-time goals only. Ignore subsequent disciplinary/administrative score changes. Retain the official match page URL and screenshot/source bytes in evidence.', units: 'goals', normalization: { origin: '0', scale: '1' }, precision: 'Integer total goals; outcomeStep 1 goal.', missingData: 'If officially rescheduled to kick off earlier than closeAt, abandoned, cancelled, not completed, not marked FT by resolveBy, or the result is outside 0–30, do not resolve. Anyone cancels at expiry and all original deposits are refunded. A postponement to after closeAt is admissible only if FT is published before resolveBy.', scheduledKickoffUTC: close, fixtureScheduleSource: 'https://www.premierleague.com/en/news/4688862', fixtureScheduleCheckedAt: new Date().toISOString(), resolverModel: 'Trusted project operator reports the official score; no live score feed or decentralized sports oracle is claimed.', distributionCaveat: 'Goals are discrete and bounded. The Gaussian is a continuous forecast curve, not exact-score probabilities.' } });
  catalog = { chainId: manifest.chainId, contract: manifest.address, preparedAt: new Date().toISOString(), markets: [
    { slug: `btc-usd-${bucket}`, closeAt: bucket, resolveBy: bucket + 3600, initialMean: (Number(ticker.price) / 1000).toFixed(8), initialSigma: '1', initialPriceSource: { url: 'https://api.exchange.coinbase.com/products/BTC-USD/ticker', price: ticker.price, time: ticker.time }, limits: { minMean: '1', maxMean: '1000', minOutcome: '1', maxOutcome: '1000', outcomeStep: '0.000001' }, rules: cryptoRules },
    football('coventry-newcastle-2026-10-12', 'Coventry City', 'Newcastle United', '2026-10-12T19:00:00.000Z', 6),
    football('everton-chelsea-2026-10-17', 'Everton', 'Chelsea', '2026-10-17T11:30:00.000Z', 7),
  ] };
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
}
fs.mkdirSync('web/public/rules', { recursive: true });
for (const item of catalog.markets) {
  const raw = JSON.stringify(canonical(item.rules)), commitment = keccak256(toBytes(raw));
  fs.writeFileSync(`web/public/rules/${item.slug}.json`, raw);
  if (item.marketId) {
    const market = await client.readContract({ address: manifest.address, abi, functionName: 'getMarket', args: [BigInt(item.marketId)] });
    if (market.rulesHash !== commitment) throw new Error('Existing market rules commitment mismatch.');
    continue;
  }
  if (!journal.some(record => record.action === `create:${item.slug}`) && BigInt(item.closeAt) <= (await client.getBlock()).timestamp) throw new Error(`${item.slug}: deadline passed; never silently change committed rules.`);
  const decimal = value => parseUnits(value, 18), bounds = Object.fromEntries(Object.entries(item.limits).map(([key, value]) => [key, decimal(value)]));
  const config = { resolver: account.address, rulesHash: commitment, rulesURI: `data:application/json;base64,${Buffer.from(raw).toString('base64')}`, units: item.rules.units, origin: decimal(item.rules.normalization.origin), scale: decimal(item.rules.normalization.scale), backing: 1000000n, k: decimal('0.5'), minSigma: decimal('0.2'), maxSigma: decimal('20'), closeAt: BigInt(item.closeAt), resolveBy: BigInt(item.resolveBy), ...bounds };
  await call(`approve:${item.slug}`, manifest.tokenAddress, tokenAbi, 'approve', [manifest.address, 1000000n]);
  const receipt = await call(`create:${item.slug}`, manifest.address, abi, 'createMarket', [config, { mean: decimal(item.initialMean), sigma: decimal(item.initialSigma) }], 1000000n);
  const log = receipt.logs.map(log => { try { return decodeEventLog({ abi, data: log.data, topics: log.topics }); } catch { return null; } }).find(log => log?.eventName === 'MarketCreated');
  if (!log) throw new Error('Successful receipt missing MarketCreated.');
  item.marketId = log.args.marketId.toString(); item.creationTransaction = receipt.transactionHash; item.rulesHash = commitment;
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Created actual market ${item.marketId}: ${item.rules.question}`);
}
console.log(`${catalog.markets.length} real-event markets verified on ${manifest.network}.`);
