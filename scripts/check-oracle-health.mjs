import fs from 'node:fs';
import { btcOraclePolicy, collectOracleHealth } from './oracle-health.mjs';
import { createPublicClient, http } from 'viem';
import { chainlinkPolicy, chainlinkClient, readChainlink } from './chainlink-oracle.mjs';

// Read-only diagnostics: no wallet loading, signing, market edits or fallback prices.
const bucketArg = process.argv.indexOf('--bucket');
let report;
if (bucketArg >= 0) {
  const bucket = Number(process.argv[bucketArg + 1]);
  report = { bucketStart: bucket, ...await collectOracleHealth(btcOraclePolicy(bucket), bucket) };
} else {
  const networkArg = process.argv.indexOf('--network');
  const network = networkArg < 0 ? 'arc-testnet' : process.argv[networkArg + 1];
  try {
    const policy = chainlinkPolicy(network);
    const manifest = JSON.parse(fs.readFileSync(`deployments/${network}.json`, 'utf8'));
    const settlementClient = createPublicClient({ transport: http(manifest.rpcUrl, { timeout: 20000, retryCount: 1 }) });
    if (await settlementClient.getChainId() !== manifest.chainId) throw new Error('Settlement RPC chain mismatch.');
    const client = chainlinkClient(policy, settlementClient, manifest.chainId);
    const observation = await readChainlink(client, policy, await client.getBlock());
    report = { network, settlementChainId: manifest.chainId, sourceChainId: policy.chainId, healthy: true, reason: 'Chainlink BTC/USD round is valid and fresh.', ...observation };
  } catch (error) {
    report = { network, healthy: false, reason: error.message };
  }
}
fs.mkdirSync('work', { recursive: true });
fs.writeFileSync('work/oracle-health.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.healthy ? 0 : 1;
