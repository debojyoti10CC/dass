#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const CHAIN_ID = 5042002;
const TOKEN = '0x3600000000000000000000000000000000000000';
const FEE_FLOOR = 20_000_000_000n;
const ZERO = '0x0000000000000000000000000000000000000000';
const defaults = { rpc: process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.io', address: TOKEN };
const opts = { ...defaults };
const values = new Set(['rpc', 'address', 'spender', 'receipt', 'output', 'wallet-rpc', 'account', 'recipient', 'amount']);
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--send') opts.send = true;
  else if (arg === '--confirm-testnet-transactions') opts.confirm = true;
  else if (arg === '--help') {
    console.log('Read only: node scripts/arc-smoke.mjs [--rpc URL] [--address ADDRESS] [--spender ADDRESS] [--receipt HASH] [--output FILE]\nOptional funded smoke: add --send --confirm-testnet-transactions --wallet-rpc URL --account ADDRESS --spender ADDRESS --recipient ADDRESS --amount MICRO_USDC. The wallet RPC must expose an unlocked account; never supply keys to this script. Amount is capped at 1 USDC.');
    process.exit(0);
  } else if (arg.startsWith('--') && values.has(arg.slice(2)) && process.argv[i + 1]) opts[arg.slice(2)] = process.argv[++i];
  else throw new Error(`Unsupported argument: ${arg}`);
}
const validateAddress = (address, name) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) throw new Error(`${name} must be a 20-byte address`);
  return address.toLowerCase();
};
const word = (address) => address.slice(2).padStart(64, '0');
const hex = (amount) => `0x${amount.toString(16)}`;
const unit = (amount, decimals) => {
  const s = amount.toString().padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
};
let nextId = 1;
async function rpc(method, params = [], url = opts.rpc) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: RPC ${body.error.code} ${body.error.message}`);
  if (!('result' in body)) throw new Error(`${method}: missing result`);
  return body.result;
}
async function save(path, data) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
async function reconcile(hash) {
  const [receipt, transaction] = await Promise.all([
    rpc('eth_getTransactionReceipt', [hash]), rpc('eth_getTransactionByHash', [hash]),
  ]);
  if (receipt) return { state: receipt.status === '0x1' ? 'confirmed' : 'reverted', receipt };
  return { state: transaction ? 'pending' : 'unknown', receipt: null };
}
async function main() {
  const address = validateAddress(opts.address, 'address');
  const chainId = Number(BigInt(await rpc('eth_chainId')));
  if (chainId !== CHAIN_ID) throw new Error(`Chain mismatch: expected ${CHAIN_ID}, received ${chainId}`);
  const blockNumberHex = await rpc('eth_blockNumber');
  const [block, code, decimalsHex, nativeHex, balanceHex, gasHex, clientVersion] = await Promise.all([
    rpc('eth_getBlockByNumber', [blockNumberHex, false]),
    rpc('eth_getCode', [TOKEN, blockNumberHex]),
    rpc('eth_call', [{ to: TOKEN, data: '0x313ce567' }, blockNumberHex]),
    rpc('eth_getBalance', [address, blockNumberHex]),
    rpc('eth_call', [{ to: TOKEN, data: `0x70a08231${word(address)}` }, blockNumberHex]),
    rpc('eth_gasPrice'), rpc('web3_clientVersion'),
  ]);
  const decimals = Number(BigInt(decimalsHex));
  if (decimals !== 6) throw new Error(`USDC decimals mismatch: expected 6, received ${decimals}`);
  if (code === '0x') throw new Error('USDC interface has no code');
  const native = BigInt(nativeHex), erc20 = BigInt(balanceHex), gasPrice = BigInt(gasHex);
  if (native / 1_000_000_000_000n !== erc20) throw new Error('Shared native/ERC20 balance conversion mismatch');
  const report = {
    checkedAt: new Date().toISOString(), mode: 'read-only', chainId, clientVersion,
    rpcUrl: new URL(opts.rpc).origin, blockNumber: Number(BigInt(blockNumberHex)), blockHash: block.hash,
    blockTime: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
    usdcAddress: TOKEN, usdcDecimals: decimals, nativeDecimals: 18,
    observedAddress: address, nativeBalanceRaw: native.toString(), erc20BalanceRaw: erc20.toString(),
    nativeUSDC: unit(native, 18), erc20USDC: unit(erc20, 6),
    nativeDustRaw: (native % 1_000_000_000_000n).toString(), sharedBalanceMatches: true,
    gasPriceRaw: gasPrice.toString(), minimumMaxFeePerGasRaw: FEE_FLOOR.toString(),
    recommendedMaxFeePerGasRaw: (gasPrice * 2n > FEE_FLOOR ? gasPrice * 2n : FEE_FLOOR).toString(),
    limitations: ['Read-only checks do not prove funded approval, transfer, escrow, or restricted-address behavior.'],
  };
  if (opts.spender) {
    const spender = validateAddress(opts.spender, 'spender');
    report.allowance = BigInt(await rpc('eth_call', [{ to: TOKEN, data: `0xdd62ed3e${word(address)}${word(spender)}` }, blockNumberHex])).toString();
  }
  if (opts.receipt) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(opts.receipt)) throw new Error('receipt must be a transaction hash');
    report.transaction = await reconcile(opts.receipt);
  }
  if (opts.send) report.fundedSmoke = await fundedSmoke(report);
  if (opts.output) await save(opts.output, report);
  console.log(JSON.stringify(report, null, 2));
}
async function fundedSmoke(report) {
  if (!opts.confirm || !opts['wallet-rpc']) throw new Error('Sending requires --confirm-testnet-transactions and --wallet-rpc');
  const account = validateAddress(opts.account, 'account');
  const spender = validateAddress(opts.spender, 'spender');
  const recipient = validateAddress(opts.recipient, 'recipient');
  if ([account, spender, recipient].includes(ZERO)) throw new Error('Zero addresses are forbidden');
  if (recipient === account) throw new Error('Recipient must differ from account for balance verification');
  if (!/^\d+$/.test(opts.amount || '')) throw new Error('amount must be positive integer micro-USDC');
  const amount = BigInt(opts.amount);
  if (amount < 1n || amount > 1_000_000n) throw new Error('Smoke amount must be between 1 and 1,000,000 micro-USDC');
  const walletChain = Number(BigInt(await rpc('eth_chainId', [], opts['wallet-rpc'])));
  if (walletChain !== CHAIN_ID) throw new Error('Wallet RPC chain mismatch');
  const accounts = await rpc('eth_accounts', [], opts['wallet-rpc']);
  if (!accounts.some((value) => value.toLowerCase() === account)) throw new Error('Wallet RPC does not expose the selected account');
  const journal = [];
  async function send(name, data, collateral = 0n) {
    const native = BigInt(await rpc('eth_getBalance', [account, 'latest']));
    const price = BigInt(await rpc('eth_gasPrice'));
    const maxFee = price * 2n > FEE_FLOOR ? price * 2n : FEE_FLOOR;
    const estimate = BigInt(await rpc('eth_estimateGas', [{ from: account, to: TOKEN, data }]));
    const gas = (estimate * 120n + 99n) / 100n;
    if (native < collateral * 1_000_000_000_000n + gas * maxFee) throw new Error(`${name}: insufficient shared balance for amount plus maximum gas`);
    const hash = await rpc('eth_sendTransaction', [{ from: account, to: TOKEN, data, gas: hex(gas), maxFeePerGas: hex(maxFee), maxPriorityFeePerGas: '0x0', value: '0x0' }], opts['wallet-rpc']);
    const record = { action: name, hash, state: 'pending', submittedAt: new Date().toISOString() };
    journal.push(record);
    await save('work/arc-smoke-transactions.json', journal);
    console.log(`${name} submitted: ${hash}`);
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      const result = await reconcile(hash);
      if (result.receipt) {
        record.state = result.state;
        record.blockNumber = Number(BigInt(result.receipt.blockNumber));
        record.feeNativeRaw = (BigInt(result.receipt.gasUsed) * BigInt(result.receipt.effectiveGasPrice)).toString();
        await save('work/arc-smoke-transactions.json', journal);
        if (result.state !== 'confirmed') throw new Error(`${name} reverted: ${hash}`);
        return result.receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    record.state = 'unknown';
    await save('work/arc-smoke-transactions.json', journal);
    throw new Error(`${name} has unknown outcome: reconcile ${hash} before another submission`);
  }
  await send('approve', `0x095ea7b3${word(spender)}${amount.toString(16).padStart(64, '0')}`);
  const allowance = BigInt(await rpc('eth_call', [{ to: TOKEN, data: `0xdd62ed3e${word(account)}${word(spender)}` }, 'latest']));
  if (allowance !== amount) throw new Error('Exact approval read-back mismatch');
  const recipientBefore = BigInt(await rpc('eth_call', [{ to: TOKEN, data: `0x70a08231${word(recipient)}` }, 'latest']));
  const receipt = await send('transfer', `0xa9059cbb${word(recipient)}${amount.toString(16).padStart(64, '0')}`, amount);
  const recipientAfter = BigInt(await rpc('eth_call', [{ to: TOKEN, data: `0x70a08231${word(recipient)}` }, 'latest']));
  if (recipientAfter - recipientBefore !== amount) throw new Error('Recipient transfer delta mismatch');
  report.mode = 'explicit-funded-approve-transfer';
  report.limitations = ['Funded smoke proves approval and ERC20 transfer only; market escrow, public deployment, and restricted-address behavior require independent verification.'];
  return { account, spender, recipient, amountMicroUSDC: amount.toString(), exactAllowanceMicroUSDC: allowance.toString(), transactions: journal, transferLogEmitters: [...new Set(receipt.logs.map((log) => log.address.toLowerCase()))], note: 'Approval and ERC20 transfer verified; transferFrom and market custody require the lifecycle suite. Approval remains at the exact smoke amount until consumed or revoked.' };
}
main().catch((error) => { console.error(`Arc smoke failed: ${error.message}`); process.exitCode = 1; });
