import fs from 'node:fs';
import { decodeEventLog, keccak256, toBytes, parseUnits } from 'viem';
import { publicRuntime, canonical } from './public-runtime.mjs';
import { footballOraclePolicy, footballCredentials, footballProviders } from './football-oracle.mjs';
import { chainlinkPolicy, chainlinkSource } from './chainlink-oracle.mjs';
import { assertMainnetReleaseGate } from './release-gate.mjs';

const network = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'arc-testnet';
if (network === 'arc-mainnet') assertMainnetReleaseGate();
const { manifest, account, client, abi, call, tokenAbi, journal } = publicRuntime(network);
const file = `deployments/${network}-real-markets.json`;
const directionMarket = (chainlink, timestamp) => {
  const start = (Math.floor(timestamp / 300) + 3) * 300, end = start + 300;
  const iso = seconds => new Date(seconds * 1000).toISOString();
  const windowStart = iso(start), windowEnd = iso(end);
  return {
    slug: `btc-up-down-${start}`, closeAt: start, resolveBy: end + 3600, initialMean: '0.5', initialSigma: '0.5', sigmaBounds: { min: '0.5', max: '0.5' },
    limits: { minMean: '0', maxMean: '1', minOutcome: '0', maxOutcome: '1', outcomeStep: '1' },
    rules: {
      kind: 'btc-five-minute-direction', question: `BTC up or down · ${windowStart.slice(0, 16).replace('T', ' ')}–${windowEnd.slice(11, 16)} UTC`, category: 'Crypto',
      source: chainlinkSource(chainlink), chainlink, windowStart, windowEnd, observationAt: windowEnd, earliestRetrievalAt: windowEnd,
      field: 'Compare the positive latestRoundData().answer from the first confirmed source-chain block at or after each window boundary, using the committed feed decimals.',
      publicationPolicy: 'Sample BTC/USD Chainlink at the first confirmed source-chain block at or after windowStart and windowEnd, whose committed boundaries are 300 seconds apart. Up if end answer is greater than or equal to start answer; Down only if lower. No exchange fallback or later-price substitution.',
      units: 'BTC direction', normalization: { origin: '0', scale: '1' }, precision: 'Binary outcome: 0=Down, 1=Up; end price equal to start price resolves Up.',
      rounding: 'No rounding; compare the exact positive integer Chainlink answers.', tiePolicy: 'Up when end price is equal to or greater than start price; Down only when lower.',
      binaryOutcomes: [{ outcome: 'Down', value: '0' }, { outcome: 'Up', value: '1' }],
      missingData: 'Missing feed, historical RPC state, invalid/stale round or out-of-bounds value blocks resolution. Anyone can cancel at expiry for original-deposit refunds.',
      evidencePolicy: 'Archive both exact feed round snapshots and their source-chain block hashes; verify each snapshot against historical chain state before signing and commit the canonical evidence hash.',
      resolverModel: `Trusted project operator reads one Chainlink BTC/USD feed on source chain ${chainlink.chainId} with historical block/round validation and settles on chain ${manifest.chainId}. This is an off-chain read, not a verified cross-chain relay. The market contract trusts its resolver wallet.`,
      initialForecastPolicy: 'The initial curve is a neutral midpoint forecast, not external odds. Every later curve is read from confirmed onchain state.',
    },
  };
};
let catalog = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
if (catalog && catalog.contract.toLowerCase() !== manifest.address.toLowerCase()) throw new Error('Catalog belongs to another contract.');
if (!catalog) {
  const credentials = footballCredentials();
  const footballMappings = fs.existsSync('work/football-oracles.json') ? JSON.parse(fs.readFileSync('work/football-oracles.json', 'utf8')).fixtures : [];
  const createFootball = footballProviders.every(provider => credentials[provider.id]) && Array.isArray(footballMappings) && ['coventry-newcastle-2026-10-12', 'everton-chelsea-2026-10-17'].every(slug => footballMappings.some(fixture => fixture.slug === slug));
  const chainlink = chainlinkPolicy(network);
  const block = await client.getBlock();
  const timestamp = Number(block.timestamp);

  const common = { rounding: 'Normalize once, then round to the nearest outcomeStep. Exact halves round away from zero.', evidencePolicy: 'Archive exact original source bytes and SHA256, retrieval UTC time, selected record, raw decimal value, normalized WAD and canonical evidence JSON. Commit the keccak256 of that JSON. A hash proves integrity, not correctness.', initialForecastPolicy: 'The initial curve is a sponsor forecast, not bookmaker odds or an externally supplied probability. Every later curve is read from confirmed onchain state.' };
  const football = (slug, home, away, close, week) => ({ slug, closeAt: Math.floor(Date.parse(close) / 1000), resolveBy: Math.floor(Date.parse(close) / 1000) + 48 * 3600, initialMean: '2.8', initialSigma: '1.7', limits: { minMean: '0', maxMean: '30', minOutcome: '0', maxOutcome: '30', outcomeStep: '1' }, rules: { ...common, question: `${home} vs ${away} · total goals`, category: 'Football', source: `https://www.premierleague.com/en/matches/premier-league/2026-27/matchweek-${week}`, field: `home full-time goals + away full-time goals for ${home} (home) vs ${away} (away), Premier League 2026/27`, observationAt: close, publicationPolicy: 'Use the first official Premier League FT result for this exact fixture completed after the committed closeAt. Count regulation and stoppage-time goals only. Ignore subsequent disciplinary/administrative score changes. Retain the official match page URL and screenshot/source bytes in evidence.', units: 'goals', normalization: { origin: '0', scale: '1' }, precision: 'Integer total goals; outcomeStep 1 goal.', missingData: 'If officially rescheduled to kick off earlier than closeAt, abandoned, cancelled, not completed, not marked FT by resolveBy, or the result is outside 0–30, do not resolve. Anyone cancels at expiry and all original deposits are refunded. A postponement to after closeAt is admissible only if FT is published before resolveBy.', scheduledKickoffUTC: close, fixtureScheduleSource: 'https://www.premierleague.com/en/news/4688862', fixtureScheduleCheckedAt: new Date().toISOString(), resolverModel: 'Trusted project operator reports the official score; no live score feed or decentralized sports oracle is claimed.', distributionCaveat: 'Goals are discrete and bounded. The Gaussian is a continuous forecast curve, not exact-score probabilities.' } });
  catalog = { chainId: manifest.chainId, contract: manifest.address, preparedAt: new Date().toISOString(), markets: [
    directionMarket(chainlink, timestamp),
    ...(createFootball ? [
      { slug: 'coventry-newcastle-2026-10-12', home: 'Coventry City', away: 'Newcastle United', close: '2026-10-12T19:00:00.000Z', week: 6 },
      { slug: 'everton-chelsea-2026-10-17', home: 'Everton', away: 'Chelsea', close: '2026-10-17T11:30:00.000Z', week: 7 },
    ].map(({ slug, home, away, close, week }) => football(slug, home, away, close, week)) : []),
  ] };
  for (const item of catalog.markets.filter(item => item.rules.category === 'Football')) {
    const mapping = footballMappings.find(fixture => fixture.slug === item.slug);
    if (!mapping || mapping.kickoffUTC !== item.rules.scheduledKickoffUTC || `${mapping.home} vs ${mapping.away} · total goals` !== item.rules.question) throw new Error(`${item.slug}: exact fixture mapping is required before creating new markets.`);
    const policy = footballOraclePolicy(mapping);
    item.rules = { ...item.rules, source: policy.sources[0].url, oracleHealth: policy,
      field: 'Sum of home and away regulation-time full-time goals for the exact committed provider fixture/team/competition/season IDs.',
      publicationPolicy: 'Use the first archived healthy snapshot in the resolution window. All three committed providers must report a completed regulation-time match and agree exactly on home score, away score and actual kickoff. No extra time, penalty shootout, awarded result or majority fallback. Later revisions do not replace the archived observation.',
      missingData: 'Unconfigured/unavailable sources, non-final status, conflicting scores, earlier reschedule, missing score or total outside 0–30 blocks resolution. If no admissible consensus is archived before resolveBy, cancel at expiry for original-deposit refunds.',
      evidencePolicy: 'Archive exact provider response bytes, SHA256 and retrieval UTC timestamps for all three. Re-parse archives and recompute normalization before signing; commit canonical evidence JSON keccak256.',
      resolverModel: 'Trusted resolver with three-provider off-chain signing checks. Not an on-chain multi-signer quorum.',
    };
  }
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
}
const newDirectionWindow = process.argv.includes('--new-window');
if (!catalog.markets.some(item => item.rules.kind === 'btc-five-minute-direction') || (newDirectionWindow && !catalog.markets.some(item => item.rules.kind === 'btc-five-minute-direction' && !item.marketId))) {
  const chainlink = chainlinkPolicy(network);
  const lastClose = Math.max(0, ...catalog.markets.filter(item => item.rules.kind === 'btc-five-minute-direction').map(item => item.closeAt));
  catalog.markets.unshift(directionMarket(chainlink, Math.max(Number((await client.getBlock()).timestamp), lastClose)));
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
  const config = { resolver: account.address, rulesHash: commitment, rulesURI: `data:application/json;base64,${Buffer.from(raw).toString('base64')}`, units: item.rules.units, origin: decimal(item.rules.normalization.origin), scale: decimal(item.rules.normalization.scale), backing: 1000000n, k: decimal('0.5'), minSigma: decimal(item.sigmaBounds?.min ?? '0.2'), maxSigma: decimal(item.sigmaBounds?.max ?? '20'), closeAt: BigInt(item.closeAt), resolveBy: BigInt(item.resolveBy), ...bounds };
  await call(`approve:${item.slug}`, manifest.tokenAddress, tokenAbi, 'approve', [manifest.address, 1000000n]);
  const receipt = await call(`create:${item.slug}`, manifest.address, abi, 'createMarket', [config, { mean: decimal(item.initialMean), sigma: decimal(item.initialSigma) }], 1000000n);
  const log = receipt.logs.map(log => { try { return decodeEventLog({ abi, data: log.data, topics: log.topics }); } catch { return null; } }).find(log => log?.eventName === 'MarketCreated');
  if (!log) throw new Error('Successful receipt missing MarketCreated.');
  item.marketId = log.args.marketId.toString(); item.creationTransaction = receipt.transactionHash; item.rulesHash = commitment;
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Created actual market ${item.marketId}: ${item.rules.question}`);
}
console.log(`${catalog.markets.length} real-event markets verified on ${manifest.network}.`);
