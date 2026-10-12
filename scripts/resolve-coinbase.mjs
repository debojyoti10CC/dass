import fs from 'node:fs';
import { keccak256, toBytes, parseUnits } from 'viem';
import { publicRuntime, canonical } from './public-runtime.mjs';
import { collectOracleHealth, readCandle, sha256, validateSettlementEvidence } from './oracle-health.mjs';
import { chainlinkClient, observationBlock, readChainlink } from './chainlink-oracle.mjs';

export async function resolveCoinbase({ network = 'arc-testnet', runtime = publicRuntime(network), fileSystem = fs, fetchImpl = fetch, clock = () => new Date(), oracleClient, catalogFile = `deployments/${network}-real-markets.json`, resolutionFile = `deployments/${network}-resolution-evidence.json`, marketSlug, selectedMarketId } = {}) {
  if (network === 'arc-mainnet' && !fileSystem.existsSync('deployments/mainnet-release-gate.json')) throw new Error('Mainnet release gate is required.');
  const { manifest, account, client, abi, call } = runtime;
  const catalog = JSON.parse(fileSystem.readFileSync(catalogFile, 'utf8'));
  const item = marketSlug ? catalog.markets.find(item => item.slug === marketSlug) : selectedMarketId ? catalog.markets.find(item => String(item.marketId) === String(selectedMarketId)) : catalog.markets.find(item => item.rules.kind === 'btc-five-minute-direction') ?? catalog.markets.find(item => item.rules.category === 'Crypto');
  if (!item?.marketId) throw new Error('Real BTC market not found.');
  const marketId = BigInt(item.marketId), rules = item.rules;
  const market = await client.readContract({ address: manifest.address, abi, functionName: 'getMarket', args: [marketId] });
  if (market.rulesHash !== keccak256(toBytes(JSON.stringify(canonical(rules)))) || market.resolver.toLowerCase() !== account.address.toLowerCase()) throw new Error('Rules or resolver mismatch.');
  const block = await client.getBlock();
  if (rules.chainlink) {
    if (await client.getChainId() !== manifest.chainId) throw new Error('Settlement RPC chain mismatch.');
    oracleClient ??= chainlinkClient(rules.chainlink, client, manifest.chainId);
  }
  if (block.timestamp * 1000n < BigInt(Date.parse(rules.earliestRetrievalAt))) throw new Error(`The real candle is not complete. Earliest admissible retrieval: ${rules.earliestRetrievalAt}`);
  if (market.status === 2) throw new Error('Cancelled markets cannot be resolved.');
  const directory = `web/public/evidence/${network}-${item.slug}`;
  const evidenceFile = `${directory}/evidence.json`;
  let rawEvidence;
  if (fileSystem.existsSync(evidenceFile)) rawEvidence = fileSystem.readFileSync(evidenceFile, 'utf8');
  else {
    if (market.status !== 0 || block.timestamp >= market.resolveBy) throw new Error('Observation can no longer be committed.');
    let sourceBytes, observationAt, oracleHealth, candle;
    if (rules.kind === 'btc-five-minute-direction') {
      const sample = async (time) => {
        const target = Date.parse(time) / 1000;
        return readChainlink(oracleClient, rules.chainlink, await observationBlock(oracleClient, target), target);
      };
      const [start, end] = await Promise.all([sample(rules.windowStart), sample(rules.windowEnd)]);
      sourceBytes = Buffer.from(JSON.stringify(canonical({ start: start.snapshot, end: end.snapshot })));
      const up = BigInt(end.snapshot.round[1]) >= BigInt(start.snapshot.round[1]);
      candle = { rawValue: up ? '1' : '0', originalObservation: sourceBytes.toString('utf8') };
      observationAt = clock().toISOString();
    } else if (rules.chainlink) {
      const target = Date.parse(rules.observationAt) / 1000;
      candle = await readChainlink(oracleClient, rules.chainlink, await observationBlock(oracleClient, target), target);
      sourceBytes = Buffer.from(candle.originalObservation);
      observationAt = clock().toISOString();
    } else if (rules.oracleHealth) {
      oracleHealth = await collectOracleHealth(rules.oracleHealth, rules.bucketStart, { fetchImpl, now: clock });
      fileSystem.mkdirSync('work', { recursive: true });
      fileSystem.writeFileSync(`work/${network}-${item.slug}-oracle-health.json`, JSON.stringify(oracleHealth, null, 2) + '\n');
      if (!oracleHealth.healthy) throw new Error(`Oracle health blocked signing: ${oracleHealth.reason}`);
      sourceBytes = Buffer.from(oracleHealth.observations[0].sourceBytes, 'base64');
      observationAt = oracleHealth.observations[0].retrievedAt;
    } else {
      const response = await fetchImpl(rules.source, { signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw new Error(`Source unavailable (${response.status}); never invent an outcome.`);
      sourceBytes = Buffer.from(await response.arrayBuffer());
      observationAt = clock().toISOString();
    }
    candle ??= readCandle('coinbase', sourceBytes, rules.bucketStart);
    const rawValue = candle.rawValue;
    const normalizedOutcome = await client.readContract({ address: manifest.address, abi, functionName: 'normalizeOutcome', args: [marketId, parseUnits(rawValue, 18)] });
    const document = { schemaVersion: 1, chainId: manifest.chainId, contract: manifest.address, marketId: item.marketId, rulesHash: market.rulesHash, source: rules.source, field: rules.field, observationAt: rules.observationAt, publicationPolicy: rules.publicationPolicy, publicationAt: observationAt, rawValue, normalizedOutcome: normalizedOutcome.toString(), originalObservation: candle.originalObservation, sourceSha256: sha256(sourceBytes), sourceArchive: `./source.json`, units: rules.units, precision: rules.precision, rounding: rules.rounding, normalization: rules.normalization, resolver: account.address, ...(rules.kind === 'btc-five-minute-direction' ? Object.fromEntries(['kind','windowStart','windowEnd','earliestRetrievalAt','tiePolicy','binaryOutcomes'].map(key => [key, rules[key]])) : {}) };
    if (oracleHealth) document.oracleHealth = { observations: oracleHealth.observations };
    rawEvidence = JSON.stringify(canonical(document));
    fileSystem.mkdirSync(directory, { recursive: true }); fileSystem.writeFileSync(`${directory}/source.json`, sourceBytes); fileSystem.writeFileSync(evidenceFile, rawEvidence);
  }
  const evidence = JSON.parse(rawEvidence), evidenceHash = keccak256(toBytes(rawEvidence));
  const normalizedOutcome = await validateSettlementEvidence({ evidence, sourceBytes: fileSystem.readFileSync(`${directory}/source.json`), rules, market, manifest, marketId, client: oracleClient ?? client, nowMs: clock().getTime(),
    normalize: raw => client.readContract({ address: manifest.address, abi, functionName: 'normalizeOutcome', args: [marketId, raw] }),
  });
  if (market.status === 1) {
    if (market.evidenceHash !== evidenceHash || market.outcome !== normalizedOutcome) throw new Error('Resolved outcome and archived evidence disagree.');
    console.log(`Existing real-source resolution verified: ${evidence.rawValue} USD.`);
  } else {
    const latest = await client.getBlock();
    if (latest.timestamp < market.closeAt || latest.timestamp >= market.resolveBy) throw new Error('Outside resolution window; do not sign.');
    const receipt = await call(`resolve:${item.slug}`, manifest.address, abi, 'resolve', [marketId, normalizedOutcome, evidenceHash]);
    fileSystem.writeFileSync(resolutionFile, JSON.stringify({ checkedAt: clock().toISOString(), contract: manifest.address, marketId: item.marketId, rawValue: evidence.rawValue, normalizedOutcome: evidence.normalizedOutcome, evidenceHash, evidencePath: evidenceFile, sourceSha256: evidence.sourceSha256, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString() }, null, 2) + '\n');
    console.log(rules.kind === 'btc-five-minute-direction' ? `Resolved BTC five-minute direction: ${evidence.rawValue === '1' ? 'Up' : 'Down'}. ${receipt.transactionHash}` : `Resolved from ${rules.chainlink ? 'Chainlink BTC/USD' : 'Coinbase candle'}: ${evidence.rawValue} USD. ${receipt.transactionHash}`);
  }
}

if (process.argv[1]?.endsWith('resolve-coinbase.mjs')) {
  const network = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'arc-testnet';
  const marketSlug = process.argv.includes('--market') ? process.argv[process.argv.indexOf('--market') + 1] : undefined;
  const selectedMarketId = process.argv.includes('--market-id') ? process.argv[process.argv.indexOf('--market-id') + 1] : undefined;
  await resolveCoinbase({ network, marketSlug, selectedMarketId });
}
