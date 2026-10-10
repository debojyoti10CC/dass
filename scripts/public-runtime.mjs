import fs from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, http, erc20Abi, keccak256, encodeFunctionData } from 'viem';
import { operatorAccount } from './operator-wallet.mjs';
import { assertMainnetReleaseGate, digest } from './release-gate.mjs';

export function publicRuntime(network = 'arc-testnet', role = 'operator') {
  if (!['arc-testnet', 'arc-mainnet'].includes(network)) throw new Error('Public Arc network required.');
  if (network === 'arc-mainnet') assertMainnetReleaseGate({ sourceSha256: digest(fs.readFileSync('work/artifacts/standard-input.json')) });
  const manifest = JSON.parse(fs.readFileSync(`deployments/${network}.json`, 'utf8'));
  if (manifest.status !== 'deployed' || !manifest.address) throw new Error('A confirmed deployment is required.');
  const account = operatorAccount({ role });
  if (role === 'operator' && account.address.toLowerCase() !== manifest.operator.toLowerCase()) throw new Error('Protected operator differs from the deployed immutable operator.');
  const chain = defineChain({ id: manifest.chainId, name: manifest.network, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [manifest.rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(manifest.rpcUrl, { timeout: 20000, retryCount: 1 }), pollingInterval: 1000 });
  const wallet = createWalletClient({ chain, account, transport: http(manifest.rpcUrl, { retryCount: 0 }) });
  const abi = JSON.parse(fs.readFileSync('work/artifacts/DistributionMarkets.json', 'utf8')).abi;
  const journalFile = `work/${network}-${role}-transactions.json`;
  const journal = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : [];
  const save = () => fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2) + '\n');
  async function confirmed(record) {
    let receipt;
    try { receipt = await client.waitForTransactionReceipt({ hash: record.hash, timeout: 60000 }); }
    catch { throw new Error(`Unknown ${record.action} outcome. Reconcile ${record.hash}; do not send a duplicate.`); }
    record.state = receipt.status === 'success' ? 'confirmed' : 'reverted';
    record.blockNumber = receipt.blockNumber.toString(); record.feeNativeRaw = (receipt.gasUsed * receipt.effectiveGasPrice).toString(); record.gasUsed = receipt.gasUsed.toString(); save();
    if (record.state !== 'confirmed') throw new Error(`${record.action} reverted: ${record.hash}`);
    return receipt;
  }
  async function send(action, transaction, deposit = 0n) {
    if (await client.getChainId() !== manifest.chainId) throw new Error('RPC chain mismatch.');
    const old = journal.find(item => item.action === action);
    if (old) {
      if (old.chainId !== chain.id || old.account.toLowerCase() !== account.address.toLowerCase() || old.contract.toLowerCase() !== manifest.address.toLowerCase() || old.inputHash !== keccak256(transaction.data ?? '0x')) throw new Error('Saved action belongs to different signer, deployment or calldata; reconcile it explicitly.');
      return confirmed(old);
    }
    if (journal.some(item => !['confirmed', 'reverted'].includes(item.state))) throw new Error('Reconcile outstanding signer transactions first.');
    const estimate = await client.estimateGas({ account: account.address, ...transaction });
    const gas = (estimate * 120n + 99n) / 100n, price = await client.getGasPrice();
    const gasPrice = price * 125n / 100n > 20000000000n ? price * 125n / 100n : 20000000000n;
    const reserve = gas * gasPrice, balance = await client.getBalance({ address: account.address });
    if (reserve > 1000000000000000000n) throw new Error('Maximum transaction fee exceeds 1 USDC.');
    if (balance < deposit * 1000000000000n + (transaction.value ?? 0n) + reserve) throw new Error(`${action}: insufficient shared USDC for collateral, value and fee reserve.`);
    const request = await wallet.prepareTransactionRequest({ ...transaction, gas, gasPrice, type: 'legacy' });
    const serializedTransaction = await wallet.signTransaction(request), hash = keccak256(serializedTransaction);
    const record = { action, hash, account: account.address, chainId: chain.id, contract: manifest.address, state: 'prepared', nonce: request.nonce, preparedAt: new Date().toISOString(), inputHash: keccak256(transaction.data ?? '0x') };
    journal.push(record); save();
    try { await wallet.sendRawTransaction({ serializedTransaction }); record.state = 'submitted'; }
    catch { record.state = 'unknown'; }
    save(); console.log(`${action}: ${hash}`);
    return confirmed(record);
  }
  async function call(action, address, contractAbi, functionName, args, deposit = 0n) {
    if (!journal.some(item => item.action === action)) await client.simulateContract({ account: account.address, address, abi: contractAbi, functionName, args });
    return send(action, { to: address, data: encodeFunctionData({ abi: contractAbi, functionName, args }), value: 0n }, deposit);
  }
  return { manifest, account, chain, client, wallet, abi, journal, send, call, tokenAbi: erc20Abi };
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
