import fs from 'node:fs';
import { keccak256, toBytes, parseUnits } from 'viem';
import { publicRuntime, canonical } from './public-runtime.mjs';
import { collectOracleHealth, readCandle, sha256, validateSettlementEvidence } from './oracle-health.mjs';

export async function resolveCoinbase({ network = 'arc-testnet', runtime = publicRuntime(network), fileSystem = fs, fetchImpl = fetch, clock = () => new Date() } = {}) {
  if (network === 'arc-mainnet' && !fileSystem.existsSync('deployments/mainnet-release-gate.json')) throw new Error('Mainnet release gate is required.');
  const { manifest, account, client, abi, call } = runtime;
  const catalog = JSON.parse(fileSystem.readFileSync(`deployments/${network}-real-markets.json`, 'utf8'));
  const item = catalog.markets.find(item => item.rules.category === 'Crypto');
  if (!item?.marketId) throw new Error('Real Coinbase market not found.');
  const marketId = BigInt(item.marketId), rules = item.rules;
  const market = await client.readContract({ address: manifest.address, abi, functionName: 'getMarket', args: [marketId] });
  if (market.rulesHash !== keccak256(toBytes(JSON.stringify(canonical(rules)))) || market.resolver.toLowerCase() !== account.address.toLowerCase()) throw new Error('Rules or resolver mismatch.');
  const block = await client.getBlock();
  if (block.timestamp * 1000n < BigInt(Date.parse(rules.earliestRetrievalAt))) throw new Error(`The real candle is not complete. Earliest admissible retrieval: ${rules.earliestRetrievalAt}`);
  if (market.status === 2) throw new Error('Cancelled markets cannot be resolved.');
  const directory = `web/public/evidence/${network}-${item.slug}`;
  const evidenceFile = `${directory}/evidence.json`;
  let rawEvidence;
  if (fileSystem.existsSync(evidenceFile)) rawEvidence = fileSystem.readFileSync(evidenceFile, 'utf8');
  else {
    if (market.status !== 0 || block.timestamp >= market.resolveBy) throw new Error('Observation can no longer be committed.');
    let sourceBytes, observationAt, oracleHealth;
    if (rules.oracleHealth) {
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
    const candle = readCandle('coinbase', sourceBytes, rules.bucketStart);
    const rawValue = candle.rawValue;
    const normalizedOutcome = await client.readContract({ address: manifest.address, abi, functionName: 'normalizeOutcome', args: [marketId, parseUnits(rawValue, 18)] });
    const document = { schemaVersion: 1, chainId: manifest.chainId, contract: manifest.address, marketId: item.marketId, rulesHash: market.rulesHash, source: rules.source, field: rules.field, observationAt: rules.observationAt, publicationPolicy: rules.publicationPolicy, publicationAt: observationAt, rawValue, normalizedOutcome: normalizedOutcome.toString(), originalObservation: candle.originalObservation, sourceSha256: sha256(sourceBytes), sourceArchive: `./source.json`, units: rules.units, precision: rules.precision, rounding: rules.rounding, normalization: rules.normalization, resolver: account.address };
    if (oracleHealth) document.oracleHealth = { observations: oracleHealth.observations };
    rawEvidence = JSON.stringify(canonical(document));
    fileSystem.mkdirSync(directory, { recursive: true }); fileSystem.writeFileSync(`${directory}/source.json`, sourceBytes); fileSystem.writeFileSync(evidenceFile, rawEvidence);
  }
  const evidence = JSON.parse(rawEvidence), evidenceHash = keccak256(toBytes(rawEvidence));
  const normalizedOutcome = await validateSettlementEvidence({ evidence, sourceBytes: fileSystem.readFileSync(`${directory}/source.json`), rules, market, manifest, marketId, nowMs: clock().getTime(),
    normalize: raw => client.readContract({ address: manifest.address, abi, functionName: 'normalizeOutcome', args: [marketId, raw] }),
  });
  if (market.status === 1) {
    if (market.evidenceHash !== evidenceHash || market.outcome !== normalizedOutcome) throw new Error('Resolved outcome and archived evidence disagree.');
    console.log(`Existing real-source resolution verified: ${evidence.rawValue} USD.`);
  } else {
    const latest = await client.getBlock();
    if (latest.timestamp < market.closeAt || latest.timestamp >= market.resolveBy) throw new Error('Outside resolution window; do not sign.');
    const receipt = await call(`resolve:${item.slug}`, manifest.address, abi, 'resolve', [marketId, normalizedOutcome, evidenceHash]);
    fileSystem.writeFileSync(`deployments/${network}-resolution-evidence.json`, JSON.stringify({ checkedAt: clock().toISOString(), contract: manifest.address, marketId: item.marketId, rawValue: evidence.rawValue, normalizedOutcome: evidence.normalizedOutcome, evidenceHash, evidencePath: evidenceFile, sourceSha256: evidence.sourceSha256, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString() }, null, 2) + '\n');
    console.log(`Resolved from actual Coinbase candle: ${evidence.rawValue} USD. ${receipt.transactionHash}`);
  }
}

if (process.argv[1]?.endsWith('resolve-coinbase.mjs')) {
  const network = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'arc-testnet';
  await resolveCoinbase({ network });
}
