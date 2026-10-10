import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, defineChain, http, erc20Abi, encodeDeployData, keccak256 } from 'viem';
import { compile } from './compile.mjs';
import { operatorAccount } from './operator-wallet.mjs';
import { assertMainnetReleaseGate } from './release-gate.mjs';

const name = process.argv[process.argv.indexOf('--network') + 1];
if (!['arc-testnet', 'arc-mainnet'].includes(name)) throw new Error('Choose --network arc-testnet or arc-mainnet explicitly.');
if (name === 'arc-mainnet') assertMainnetReleaseGate();
process.env.DASS_DEPLOYMENT = name;
const file = `deployments/${name}.json`, manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const account = operatorAccount(), chain = defineChain({ id: manifest.chainId, name: manifest.network, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [manifest.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(manifest.rpcUrl, { timeout: 20000, retryCount: 1 }), pollingInterval: 1000 });
const wallet = createWalletClient({ account, chain, transport: http(manifest.rpcUrl, { retryCount: 0 }) });
const artifact = compile({ writeFrontend: false }).DistributionMarkets;
if (await client.getChainId() !== manifest.chainId) throw new Error('RPC chain mismatch.');
if (await client.readContract({ address: manifest.tokenAddress, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('Arc native token decimals mismatch.');
const sourceSha256 = createHash('sha256').update(fs.readFileSync('work/artifacts/standard-input.json')).digest('hex');
if (name === 'arc-mainnet') assertMainnetReleaseGate({ sourceSha256 });
const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [manifest.tokenAddress, account.address] });
const journalFile = `work/${name}-deployment-journal.json`;
let journal = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : undefined;
if (journal && journal.sourceSha256 !== sourceSha256) throw new Error('Source changed after a deployment was prepared. Reconcile the saved hash; do not overwrite its journal.');
if (!journal && !manifest.address) {
  const gasEstimate = await client.estimateGas({ account: account.address, data });
  const gas = (gasEstimate * 120n + 99n) / 100n;
  const price = await client.getGasPrice(), gasPrice = price * 125n / 100n > 20000000000n ? price * 125n / 100n : 20000000000n;
  const balance = await client.getBalance({ address: account.address }), reserve = gas * gasPrice;
  console.log(JSON.stringify({ network: manifest.network, operator: account.address, balanceUSDC: Number(balance) / 1e18, estimatedGas: gasEstimate.toString(), maximumDeploymentFeeUSDC: Number(reserve) / 1e18, sourceSha256, bytecodeBytes: (artifact.bytecode.length - 2) / 2 }));
  if (!process.argv.includes('--broadcast')) process.exit(0);
  if (reserve > 1000000000000000000n) throw new Error('Deployment maximum fee exceeds the 1 USDC run cap.');
  if (balance < reserve) throw new Error(`Fund ${account.address} on ${manifest.network} before deployment.`);
  const request = await wallet.prepareTransactionRequest({ data, gas, gasPrice, type: 'legacy', value: 0n });
  const serializedTransaction = await wallet.signTransaction(request), hash = keccak256(serializedTransaction);
  journal = { chainId: chain.id, operator: account.address, sourceSha256, hash, state: 'prepared', preparedAt: new Date().toISOString(), nonce: request.nonce };
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
  // The hash is durable before submitting. An ambiguous RPC response never causes a fresh deployment.
  try { await wallet.sendRawTransaction({ serializedTransaction }); journal.state = 'submitted'; }
  catch { journal.state = 'unknown'; }
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
}
if (!journal && manifest.address) {
  console.log(`Existing deployment ${manifest.address}; checking recorded receipt.`);
  journal = { hash: manifest.deploymentTransaction, sourceSha256: manifest.sourceSha256 };
}
if (!journal) throw new Error('Missing deployment journal.');
console.log(`Reconciling deployment ${journal.hash}`);
let receipt;
try { receipt = await client.waitForTransactionReceipt({ hash: journal.hash, timeout: 60000 }); }
catch { throw new Error(`Deployment outcome is unknown. Reconcile ${journal.hash} before submitting another deployment.`); }
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deployment reverted: ${journal.hash}`);
const address = receipt.contractAddress;
const [token, operator, code] = await Promise.all([
  client.readContract({ address, abi: artifact.abi, functionName: 'token' }),
  client.readContract({ address, abi: artifact.abi, functionName: 'operator' }),
  client.getBytecode({ address }),
]);
if (!code || code.length < 100 || token.toLowerCase() !== manifest.tokenAddress.toLowerCase() || operator.toLowerCase() !== account.address.toLowerCase()) throw new Error('Deployment getters or code mismatch.');
Object.assign(manifest, { address, operator, deploymentBlock: Number(receipt.blockNumber), deploymentTransaction: journal.hash, sourceSha256: journal.sourceSha256, status: 'deployed', note: 'Actual successful public-chain deployment. Source verification and market acceptance are recorded separately.' });
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(`deployments/${name}-deployment-evidence.json`, JSON.stringify({ checkedAt: new Date().toISOString(), chainId: chain.id, address, operator, token, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, status: receipt.status, gasUsed: receipt.gasUsed.toString(), feeNativeRaw: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), runtimeCodeHash: keccak256(code), sourceSha256: journal.sourceSha256 }, null, 2) + '\n');
journal.state = 'confirmed'; fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
compile();
console.log(`Deployed ${manifest.network}: ${manifest.explorerUrl}/address/${address}`);
