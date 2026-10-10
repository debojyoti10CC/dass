import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, defineChain, erc20Abi, keccak256, toBytes } from 'viem';
import { compile } from './compile.mjs';

const rpcUrl = process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:8547';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(rpcUrl).hostname)) throw new Error('Demo seeding is restricted to a disposable local node');
const chain = defineChain({ id: 5042002, name: 'Local Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const transport = http(rpcUrl), publicClient = createPublicClient({ chain, transport, cacheTime: 0, pollingInterval: 50 });
if (await publicClient.getChainId() !== 5042002) throw new Error('Start npm run node:arc first');
const accounts = await publicClient.request({ method: 'eth_accounts' });
if (accounts.length < 4) throw new Error('Local Arc node needs four disposable accounts');
const wallets = accounts.map(account => createWalletClient({ account, chain, transport }));
const tokenAddress = '0x3600000000000000000000000000000000000000';
if (await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('Local Arc native USDC predeploy missing');
const artifacts = compile();
const bytecode = artifacts.DistributionMarkets.bytecode;
const hash = await wallets[0].deployContract({ abi: artifacts.DistributionMarkets.abi, bytecode, args: [tokenAddress, accounts[0]], gas: 12_000_000n, gasPrice: 25_000_000_000n });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success') throw new Error('Local deployment reverted');
const address = receipt.contractAddress, abi = artifacts.DistributionMarkets.abi;
async function transact(wallet, contractAddress, contractAbi, functionName, args) {
  const { request } = await publicClient.simulateContract({ account: wallet.account, address: contractAddress, abi: contractAbi, functionName, args });
  const gas = await publicClient.estimateContractGas({ account: wallet.account, address: contractAddress, abi: contractAbi, functionName, args });
  const transactionHash = await wallet.writeContract({ ...request, gas: gas * 120n / 100n, gasPrice: 25_000_000_000n });
  const confirmed = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (confirmed.status !== 'success') throw new Error(`${functionName} reverted`);
  return transactionHash;
}
const WAD = 10n ** 18n, backing = 10_000_000n;
const timestamp = (await publicClient.getBlock()).timestamp;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, canonical(item)]));
  return value;
}
fs.mkdirSync('web/public/rules', { recursive: true });
for (let index = 0; index < 2; index++) {
  const closeAt = timestamp + (index === 0 ? 86400n : 172800n), resolveBy = closeAt + 86400n;
  const rules = { question: index === 0 ? 'Local demo: what temperature will the fixture station report?' : 'Local demo: will the fixture observation arrive before expiry?', source: 'Bundled synthetic fixture. This is a local demonstration, not a live weather observation.', field: 'temperatureC', observationAt: new Date(Number(closeAt) * 1000).toISOString(), publicationPolicy: 'Use the first fixture publication only; later revisions do not apply.', units: '°C', normalization: { origin: '0', scale: '1' }, precision: '6 normalized decimal places (outcomeStep 0.000001)', rounding: 'Normalize once and round to the nearest canonical outcomeStep; exact halves away from zero.', missingData: 'If no admissible fixture is published before resolveBy, anyone cancels at expiry; every original deposit is refunded.', evidencePolicy: 'Retain exact UTF-8 evidence JSON including raw observation, source, observation time, normalization and normalized WAD. Commit its keccak256 hash.' };
  const raw = JSON.stringify(canonical(rules)), fileName = `local-fixture-${index + 1}.json`;
  fs.writeFileSync(`web/public/rules/${fileName}`, raw);
  const config = { resolver: accounts[3], rulesHash: keccak256(toBytes(raw)), rulesURI: `/rules/${fileName}`, units: '°C', origin: 0n, scale: WAD, outcomeStep: 10n ** 12n, backing, k: 10n * WAD, minMean: -100n * WAD, maxMean: 100n * WAD, minSigma: WAD, maxSigma: 100n * WAD, minOutcome: -100n * WAD, maxOutcome: 100n * WAD, closeAt, resolveBy };
  await transact(wallets[0], tokenAddress, erc20Abi, 'approve', [address, backing]);
  await transact(wallets[0], address, abi, 'createMarket', [config, { mean: 20n * WAD, sigma: 4n * WAD }]);
}
let sourceCommit = null;
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const manifest = { network: 'Local Arc', chainId: 5042002, rpcUrl, explorerUrl: '', tokenAddress, address, deploymentBlock: Number(receipt.blockNumber), deploymentTransaction: hash, sourceCommit, verificationUrl: null, status: 'local', operator: accounts[0], resolver: accounts[3], compilerVersion: artifacts.DistributionMarkets.compiler, note: 'Disposable localhost Arc runtime. Public Arc Testnet deployment is separate.' };
fs.writeFileSync('deployments/local.json', JSON.stringify(manifest, null, 2) + '\n');
process.env.DASS_DEPLOYMENT = 'local'; compile();
fs.mkdirSync('work', { recursive: true }); fs.writeFileSync('work/local-demo.json', JSON.stringify({ ...manifest, accounts }, null, 2) + '\n');
console.log(`Seeded two local fixture markets at ${address}. Use npm run dev:local. Disposable account addresses are in work/local-demo.json.`);
