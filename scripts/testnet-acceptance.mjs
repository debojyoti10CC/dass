import fs from 'node:fs';
import assert from 'node:assert/strict';
import { decodeEventLog, parseUnits } from 'viem';
import { operatorAccount } from './operator-wallet.mjs';
import { publicRuntime } from './public-runtime.mjs';

const operator = publicRuntime('arc-testnet');
const { manifest, abi, client } = operator;
const catalog = JSON.parse(fs.readFileSync('deployments/arc-testnet-real-markets.json', 'utf8'));
const observation = catalog.markets.find(item => item.rules.category === 'Crypto');
if (!observation?.marketId) throw new Error('A real Coinbase observation market must be created first.');
const marketId = BigInt(observation.marketId), address = manifest.address;
const stage = process.argv.includes('--settle') ? 'settle' : 'trade';
const proofFile = 'deployments/arc-testnet-acceptance-evidence.json';
let proof = fs.existsSync(proofFile) ? JSON.parse(fs.readFileSync(proofFile, 'utf8')) : { chainId: manifest.chainId, contract: address, marketId: observation.marketId, wallets: {}, receipts: {}, transactions: [], scope: 'Actual public Arc Testnet transactions with native USDC, separate funded wallets and a real Coinbase Exchange BTC-USD observation.' };
if (proof.contract !== address) throw new Error('Acceptance evidence belongs to another deployment.');
const save = () => fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2) + '\n');
for (const role of ['trader-a', 'trader-b']) {
  operatorAccount({ create: true, role });
  const trader = publicRuntime('arc-testnet', role);
  proof.wallets[role] = trader.account.address;
  if (stage === 'trade') {
    const funded = await operator.send(`fund:${role}`, { to: trader.account.address, value: 3000000000000000000n });
    proof.transactions.push({ action: `Fund ${role}`, hash: funded.transactionHash }); save();
    await trader.call('approve:acceptance', manifest.tokenAddress, trader.tokenAbi, 'approve', [address, 1000000n]);
    if (!proof.receipts[role]) {
      const market = await client.readContract({ address, abi, functionName: 'getMarket', args: [marketId] });
      const initialMean = parseUnits(observation.initialMean, 18);
      const curve = { mean: initialMean + (role === 'trader-a' ? 50000000000000000n : -50000000000000000n), sigma: role === 'trader-a' ? 900000000000000000n : 1100000000000000000n };
      const timestamp = (await client.getBlock()).timestamp;
      const receipt = await trader.call('trade:acceptance', address, abi, 'trade', [marketId, curve, market.nonce, 1000000n, timestamp + 300n], 1000000n);
      const event = receipt.logs.map(log => { try { return decodeEventLog({ abi, data: log.data, topics: log.topics }); } catch { return null; } }).find(log => log?.eventName === 'CurveChanged');
      assert.ok(event); proof.receipts[role] = event.args.receiptId.toString();
      proof.transactions.push({ action: `Forecast ${role}`, hash: receipt.transactionHash }); save();
    }
  } else {
    const market = await client.readContract({ address, abi, functionName: 'getMarket', args: [marketId] });
    assert.equal(market.status, 1, 'Resolve from archived real-source evidence before claims.');
    assert.ok(proof.receipts[role]);
    const receipt = await trader.call('claim:acceptance', address, abi, 'claim', [BigInt(proof.receipts[role])]);
    const event = receipt.logs.map(log => { try { return decodeEventLog({ abi, data: log.data, topics: log.topics }); } catch { return null; } }).find(log => log?.eventName === 'PositionClaimed');
    assert.ok(event, 'Claim receipt must contain PositionClaimed.');
    proof.transactions.push({ action: `Claim ${role}`, hash: receipt.transactionHash });
    proof[`${role}PayoutMicro`] = event.args.amount.toString(); save();
  }
}
if (stage === 'trade') {
  const trader = publicRuntime('arc-testnet', 'trader-a');
  const market = await client.readContract({ address, abi, functionName: 'getMarket', args: [marketId] });
  let rejected = false;
  try { await client.simulateContract({ account: trader.account.address, address, abi, functionName: 'trade', args: [marketId, { mean: market.currentCurve.mean + 1n, sigma: market.currentCurve.sigma }, 0n, 1000000n, (await client.getBlock()).timestamp + 60n] }); }
  catch (error) { rejected = /StalePreview/.test(error.message); }
  assert.ok(rejected, 'Stale nonce must be rejected by public-chain simulation.');
  proof.staleNonceRejected = true; proof.stage = 'traded-awaiting-real-observation';
} else {
  const receipt = await operator.call('claim:sponsor-acceptance', address, abi, 'claimSponsor', [marketId]);
  proof.transactions.push({ action: 'Sponsor claim', hash: receipt.transactionHash });
  const [market, liability, tokenBalance] = await Promise.all([
    client.readContract({ address, abi, functionName: 'getMarket', args: [marketId] }),
    client.readContract({ address, abi, functionName: 'totalLiability' }),
    client.readContract({ address: manifest.tokenAddress, abi: operator.tokenAbi, functionName: 'balanceOf', args: [address] }),
  ]);
  assert.equal(market.paid, market.deposited); assert.equal(tokenBalance, liability);
  proof.conservation = { depositedMicro: market.deposited.toString(), paidMicro: market.paid.toString(), totalLiabilityMicro: liability.toString(), contractTokenBalanceMicro: tokenBalance.toString(), matches: true };
  proof.stage = 'resolved-and-fully-claimed';
}
proof.checkedAt = new Date().toISOString();
proof.transactions = [...new Map(proof.transactions.map(item => [item.hash, item])).values()]; save();
console.log(JSON.stringify(proof, null, 2));
