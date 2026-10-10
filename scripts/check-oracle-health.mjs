import fs from 'node:fs';
import { btcOraclePolicy, collectOracleHealth } from './oracle-health.mjs';

// Read-only diagnostics: no wallet loading, signing, market edits or fallback prices.
const bucketArg = process.argv.indexOf('--bucket');
const bucket = bucketArg < 0 ? Math.floor(Date.now() / 60000) * 60 - 120 : Number(process.argv[bucketArg + 1]);
const health = await collectOracleHealth(btcOraclePolicy(bucket), bucket);
const report = { bucketStart: bucket, ...health };
fs.mkdirSync('work', { recursive: true });
fs.writeFileSync('work/oracle-health.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ bucketStart: bucket, healthy: health.healthy, reason: health.reason, sources: health.observations.map(({ id, rawValue, error, retrievedAt }) => ({ id, rawValue, error, retrievedAt })) }, null, 2));
process.exitCode = health.healthy ? 0 : 1;
