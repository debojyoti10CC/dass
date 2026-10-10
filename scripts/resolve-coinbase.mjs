import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { keccak256, toBytes, parseUnits } from 'viem';
import { publicRuntime, canonical } from './public-runtime.mjs';

const network = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'arc-testnet';
if (network === 'arc-mainnet' && !fs.existsSync('deployments/mainnet-release-gate.json')) throw new Error('Mainnet release gate is required.');
const { manifest, account, client, abi, call } = publicRuntime(network);
const catalog = JSON.parse(fs.readFileSync(`deployments/${network}-real-markets.json`, 'utf8'));
const item = catalog.markets.find(item => item.rules.category === 'Crypto');
if (!item?.marketId) throw new Error('Real Coinbase market not found.');
const marketId = BigInt(item.marketId), rules = item.rules;
const market = await client.readContract({ address: manifest.address, abi, functionName: 'getMarket', args: [marketId] });
if (market.rulesHash !== keccak256(toBytes(JSON.stringify(canonical(rules)))) || market.resolver.toLowerCase() !== account.address.toLowerCase()) throw new Error('Rules or resolver mismatch.');
const block = await client.getBlock();
if (block.timestamp * 1000n < BigInt(Date.parse(rules.earliestRetrievalAt))) throw new Error(`The real candle is not complete. Earliest admissible retrieval: ${rules.earliestRetrievalAt}`);
const directory = `web/public/evidence/${network}-${item.slug}`;
const evidenceFile = `${directory}/evidence.json`;
let rawEvidence;
if (fs.existsSync(evidenceFile)) rawEvidence = fs.readFileSync(evidenceFile, 'utf8');
else {
  if (market.status !== 0 || block.timestamp >= market.resolveBy) throw new Error('Observation can no longer be committed.');
  const response = await fetch(rules.source, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Source unavailable (${response.status}); never invent an outcome.`);
  const sourceBytes = Buffer.from(await response.arrayBuffer()), data = JSON.parse(sourceBytes.toString('utf8'));
  if (!Array.isArray(data)) throw new Error('Invalid Coinbase response.');
  const rows = data.filter(row => Array.isArray(row) && row[0] === rules.bucketStart);
  if (rows.length !== 1 || rows[0].length !== 6 || rows[0].some(value => !Number.isFinite(value)) || rows[0][4] <= 0) throw new Error('Exactly one finite completed candle with the committed timestamp is required.');
  const rawValue = String(rows[0][4]);
  const normalizedOutcome = await client.readContract({ address: manifest.address, abi, functionName: 'normalizeOutcome', args: [marketId, parseUnits(rawValue, 18)] });
  const document = { schemaVersion: 1, chainId: manifest.chainId, contract: manifest.address, marketId: item.marketId, rulesHash: market.rulesHash, source: rules.source, field: rules.field, observationAt: rules.observationAt, publicationPolicy: rules.publicationPolicy, publicationAt: new Date().toISOString(), rawValue, normalizedOutcome: normalizedOutcome.toString(), originalObservation: JSON.stringify(rows[0]), sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'), sourceArchive: `./source.json`, normalization: rules.normalization, resolver: account.address };
  rawEvidence = JSON.stringify(canonical(document));
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(`${directory}/source.json`, sourceBytes); fs.writeFileSync(evidenceFile, rawEvidence);
}
const evidence = JSON.parse(rawEvidence), evidenceHash = keccak256(toBytes(rawEvidence));
if (market.status === 1) {
  if (market.evidenceHash !== evidenceHash || market.outcome !== BigInt(evidence.normalizedOutcome)) throw new Error('Resolved outcome and archived evidence disagree.');
  console.log(`Existing real-source resolution verified: ${evidence.rawValue} USD.`);
} else {
  const receipt = await call(`resolve:${item.slug}`, manifest.address, abi, 'resolve', [marketId, BigInt(evidence.normalizedOutcome), evidenceHash]);
  fs.writeFileSync(`deployments/${network}-resolution-evidence.json`, JSON.stringify({ checkedAt: new Date().toISOString(), contract: manifest.address, marketId: item.marketId, rawValue: evidence.rawValue, normalizedOutcome: evidence.normalizedOutcome, evidenceHash, evidencePath: evidenceFile, sourceSha256: evidence.sourceSha256, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString() }, null, 2) + '\n');
  console.log(`Resolved from actual Coinbase candle: ${evidence.rawValue} USD. ${receipt.transactionHash}`);
}
