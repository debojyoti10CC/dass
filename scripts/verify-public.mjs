import fs from 'node:fs';
import { encodeAbiParameters } from 'viem';
const network = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'arc-testnet';
if (!['arc-testnet', 'arc-mainnet'].includes(network)) throw new Error('Public network required.');
const file = `deployments/${network}.json`, manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
if (manifest.status !== 'deployed') throw new Error('Deploy first.');
const artifact = JSON.parse(fs.readFileSync('work/artifacts/DistributionMarkets.json', 'utf8'));
const constructor = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [manifest.tokenAddress, manifest.operator]).slice(2);
const form = new FormData();
for (const [key, value] of Object.entries({ contractaddress: manifest.address, contractname: 'contracts/src/DistributionMarkets.sol:DistributionMarkets', codeformat: 'solidity-standard-json-input', compilerversion: `v${artifact.compiler.split('.Emscripten')[0]}`, sourceCode: fs.readFileSync('work/artifacts/standard-input.json', 'utf8'), constructorArguments: constructor, autodetectConstructorArguments: 'false', licenseType: '3' })) form.set(key, value);
const savedFile = `work/${network}-verification.json`;
const saved = fs.existsSync(savedFile) ? JSON.parse(fs.readFileSync(savedFile, 'utf8')) : undefined;
let submitted = saved?.address === manifest.address ? saved.submission : saved?.result?.startsWith(manifest.address.slice(2)) ? saved : undefined;
if (!submitted) {
  const response = await fetch(`${manifest.explorerUrl}/api?module=contract&action=verifysourcecode`, { method: 'POST', body: form, signal: AbortSignal.timeout(45000) });
  submitted = await response.json();
}
console.log(JSON.stringify({ submission: submitted }));
fs.writeFileSync(savedFile, JSON.stringify({ address: manifest.address, submission: submitted }, null, 2));
if (submitted.status !== '1') throw new Error('Explorer did not accept verification. See the saved response; do not mark verified.');
const result = await fetch(`${manifest.explorerUrl}/api?module=contract&action=checkverifystatus&guid=${encodeURIComponent(submitted.result)}`, { signal: AbortSignal.timeout(30000) });
const status = await result.json(); console.log(JSON.stringify({ status }));
if (status.status === '1' && /pass|verified/i.test(status.result)) {
  manifest.verificationUrl = `${manifest.explorerUrl}/address/${manifest.address}?tab=contract`;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(`deployments/${network}-verification-evidence.json`, JSON.stringify({ checkedAt: new Date().toISOString(), address: manifest.address, submitted, status, url: manifest.verificationUrl }, null, 2) + '\n');
} else throw new Error('Verification is pending or failed. Reconcile the saved GUID before claiming success.');
