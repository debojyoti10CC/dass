import fs from 'node:fs';
import { createPublicClient, http, formatUnits, isAddress, parseAbi } from 'viem';
import { canonical } from './public-runtime.mjs';

export const chainlinkAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function chainlinkPolicy(network, fileSystem = fs) {
  const feed = JSON.parse(fileSystem.readFileSync('config/chainlink-feeds.json', 'utf8'))[network];
  const policy = { version: 1, type: 'chainlink-btc-usd', ...feed };
  validatePolicy(policy);
  return policy;
}

function validatePolicy(policy) {
  if (policy?.version !== 1 || policy.type !== 'chainlink-btc-usd' || ![5042, 5042002].includes(policy.chainId) || !isAddress(policy.address ?? '') || /^0x0{40}$/i.test(policy.address) || !Number.isInteger(policy.decimals) || policy.decimals < 0 || policy.decimals > 18 || !Number.isSafeInteger(policy.maxAgeSeconds) || policy.maxAgeSeconds <= 0) throw new Error('A verified Chainlink BTC/USD feed for this network is required in config/chainlink-feeds.json. No exchange fallback.');
  if (policy.settlementChainId !== undefined && !(policy.chainId === 5042 && policy.settlementChainId === 5042002)) throw new Error('Unsupported Chainlink source/settlement chain combination.');
}

export const chainlinkSource = policy => `https://${policy.chainId === 5042002 ? 'explorer.testnet.arc.io' : 'explorer.arc.io'}/address/${policy.address}`;

export function chainlinkClient(policy, settlementClient, settlementChainId) {
  validatePolicy(policy);
  if ((policy.settlementChainId ?? policy.chainId) !== settlementChainId) throw new Error('Chainlink settlement chain mismatch.');
  if (policy.chainId === settlementChainId) return settlementClient;
  return createPublicClient({ transport: http('https://rpc.mainnet.arc.io', { timeout: 20000, retryCount: 1 }) });
}

// Find the first block at/after the target, so a later caller cannot choose a later price.
export async function observationBlock(client, target) {
  if (!Number.isSafeInteger(target) || target < 0) throw new Error('Invalid Chainlink observation time.');
  const latest = await client.getBlock();
  if (latest.timestamp < BigInt(target)) throw new Error('Chainlink observation time has not arrived.');
  let low = 0n, high = latest.number;
  while (low < high) {
    const middle = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: middle });
    if (block.timestamp < BigInt(target)) low = middle + 1n;
    else high = middle;
  }
  return client.getBlock({ blockNumber: low });
}

export async function readChainlink(client, policy, block, target) {
  validatePolicy(policy);
  if (await client.getChainId() !== policy.chainId) throw new Error('Chainlink RPC chain mismatch.');
  const read = functionName => client.readContract({ address: policy.address, abi: chainlinkAbi, functionName, blockNumber: block.number });
  const [decimals, description, round] = await Promise.all([read('decimals'), read('description'), read('latestRoundData')]);
  if (decimals !== policy.decimals || description !== 'BTC / USD') throw new Error('Chainlink feed identity/decimals mismatch.');
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = round;
  if (roundId <= 0n || answer <= 0n || startedAt <= 0n || startedAt > updatedAt || updatedAt > block.timestamp || block.timestamp - updatedAt > BigInt(policy.maxAgeSeconds) || answeredInRound < roundId) throw new Error('Chainlink round is invalid, stale or incomplete.');
  if (!block.hash || block.number === null) throw new Error('Confirmed Chainlink block required.');
  if (target !== undefined) {
    if (block.number === 0n) throw new Error('Chainlink observation block has no predecessor.');
    const previous = await client.getBlock({ blockNumber: block.number - 1n });
    if (block.timestamp < BigInt(target) || previous.timestamp >= BigInt(target)) throw new Error('Not the first block at/after the Chainlink observation time.');
  }
  const snapshot = { chainId: policy.chainId, address: policy.address, decimals, description, blockNumber: String(block.number), blockHash: block.hash, blockTimestamp: String(block.timestamp), round: round.map(String) };
  return { rawValue: formatUnits(answer, decimals), originalObservation: JSON.stringify(canonical(snapshot)), snapshot };
}

export async function validateChainlinkObservation(client, rules, sourceBytes, manifest, market) {
  const policy = rules.chainlink;
  validatePolicy(policy);
  const target = Date.parse(rules.observationAt) / 1000;
  if (!Number.isSafeInteger(target) || (policy.settlementChainId ?? policy.chainId) !== manifest.chainId || rules.source !== chainlinkSource(policy) || Date.parse(rules.earliestRetrievalAt) !== target * 1000 || BigInt(target) <= market.closeAt || BigInt(target) >= market.resolveBy || rules.oracleHealth) throw new Error('Chainlink rules/chain/window mismatch.');
  const snapshot = JSON.parse(Buffer.from(sourceBytes).toString('utf8'));
  if (!/^\d+$/.test(snapshot.blockNumber ?? '')) throw new Error('Invalid Chainlink archive block number.');
  const block = await client.getBlock({ blockNumber: BigInt(snapshot.blockNumber) });
  if (block.timestamp >= market.resolveBy) throw new Error('Chainlink observation outside resolution window.');
  const observation = await readChainlink(client, policy, block, target);
  if (!equal(snapshot, observation.snapshot)) throw new Error('Chainlink archive disagrees with the onchain round/block.');
  return observation;
}

export async function validateBtcDirectionObservation(client, rules, sourceBytes, manifest, market) {
  const policy = rules.chainlink;
  validatePolicy(policy);
  const start = Date.parse(rules.windowStart) / 1000;
  const end = Date.parse(rules.windowEnd) / 1000;
  const wad = 10n ** 18n;
  if (rules.kind !== 'btc-five-minute-direction' || rules.tiePolicy !== 'Up when end price is equal to or greater than start price; Down only when lower.' || !equal(rules.binaryOutcomes, [{ outcome: 'Down', value: '0' }, { outcome: 'Up', value: '1' }]) || !equal(rules.normalization, { origin: '0', scale: '1' }) || rules.observationAt !== rules.windowEnd || rules.oracleHealth || !Number.isSafeInteger(start) || end !== start + 300 || rules.source !== chainlinkSource(policy) || Date.parse(rules.earliestRetrievalAt) !== end * 1000 || (policy.settlementChainId ?? policy.chainId) !== manifest.chainId || BigInt(start) !== market.closeAt || BigInt(end) >= market.resolveBy || market.origin !== 0n || market.scale !== wad || market.outcomeStep !== wad || market.minOutcome !== 0n || market.maxOutcome !== wad || market.minMean !== 0n || market.maxMean !== wad || market.minSigma !== wad / 2n || market.maxSigma !== wad / 2n) throw new Error('BTC direction rules/window or binary market configuration mismatch.');
  if (await client.getChainId() !== policy.chainId) throw new Error('Chainlink RPC chain mismatch.');
  const archive = JSON.parse(Buffer.from(sourceBytes).toString('utf8'));
  for (const key of ['start', 'end']) {
    const target = key === 'start' ? start : end;
    if (!/^[0-9]+$/.test(archive[key]?.blockNumber ?? '')) throw new Error(`Invalid ${key} Chainlink archive block.`);
    const block = await client.getBlock({ blockNumber: BigInt(archive[key].blockNumber) });
    if (block.timestamp >= market.resolveBy) throw new Error(`${key} Chainlink observation outside resolution window.`);
    const observation = await readChainlink(client, policy, block, target);
    if (!equal(archive[key], observation.snapshot)) throw new Error(`${key} Chainlink archive disagrees with the onchain round/block.`);
  }
  if (BigInt(archive.start.round[1]) <= 0n || BigInt(archive.end.round[1]) <= 0n) throw new Error('BTC direction prices must be positive.');
  if (BigInt(archive.start.blockTimestamp) < BigInt(start) || BigInt(archive.end.blockTimestamp) < BigInt(end)) throw new Error('BTC direction observation precedes its window boundary.');
  return BigInt(archive.end.round[1]) >= BigInt(archive.start.round[1]) ? 1n : 0n;
}
