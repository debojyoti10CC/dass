import fs from 'node:fs';
import assert from 'node:assert/strict';
import { decodeEventLog, keccak256, toBytes, parseUnits } from 'viem';
import { publicRuntime, canonical } from './public-runtime.mjs';

const operator = publicRuntime('arc-testnet'), trader = publicRuntime('arc-testnet', 'trader-a'), stranger = publicRuntime('arc-testnet', 'trader-b');
const { manifest, client, abi } = operator, address = manifest.address;
const file = 'deployments/arc-testnet-expiry-evidence.json';
let proof = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
const save = () => fs.writeFileSync(file, JSON.stringify(proof, null, 2) + '\n');
const event = (receipt, name) => receipt.logs.map(log => { try { return decodeEventLog({ abi, data: log.data, topics: log.topics }); } catch { return null; } }).find(item => item?.eventName === name);
if (!proof) {
  const timestamp = Number((await client.getBlock()).timestamp), bucket = (Math.floor(timestamp / 60) + 2) * 60;
  const iso = seconds => new Date(seconds * 1000).toISOString();
  const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/ticker');
  if (!response.ok) throw new Error('Real initial price unavailable.');
  const ticker = await response.json();
  if (!/^\d+(\.\d+)?$/.test(ticker.price) || Math.abs(Date.parse(ticker.time) / 1000 - timestamp) > 120) throw new Error('Invalid or stale ticker.');
  const template = JSON.parse(fs.readFileSync('deployments/arc-testnet-real-markets.json', 'utf8')).markets.find(item => item.rules.category === 'Crypto');
  const rules = { ...template.rules, question: `BTC/USD ${iso(bucket + 60).slice(0, 16).replace('T', ' ')} UTC · expiry recovery test`, source: `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${iso(bucket)}&end=${iso(bucket + 60)}`, field: `close (index 4) of the unique BTC-USD candle with timestamp ${bucket}`, bucketStart: bucket, observationAt: iso(bucket + 60), earliestRetrievalAt: iso(bucket + 90), publicationPolicy: 'Public testnet recovery exercise: the actual future BTC/USD candle is the event, but the resolver intentionally does not submit a result. This market must expire, not resolve.', missingData: 'A missing resolver report at resolveBy allows any wallet to cancel and refund all original deposits. No fabricated observation is submitted. This is explicitly a testnet recovery exercise.' };
  proof = { chainId: manifest.chainId, contract: address, slug: `btc-expiry-${bucket}`, rules, closeAt: bucket, resolveBy: bucket + 120, initialMean: (Number(ticker.price) / 1000).toFixed(8), initialPriceSource: { price: ticker.price, time: ticker.time }, sponsor: operator.account.address, trader: trader.account.address, canceller: stranger.account.address, stage: 'prepared', transactions: [] }; save();
}
assert.equal(proof.contract, address);
if (!proof.marketId) {
  const raw = JSON.stringify(canonical(proof.rules));
  const config = { resolver: operator.account.address, rulesHash: keccak256(toBytes(raw)), rulesURI: `data:application/json;base64,${Buffer.from(raw).toString('base64')}`, units: proof.rules.units, origin: 0n, scale: parseUnits('1000', 18), outcomeStep: parseUnits('0.000001', 18), backing: 1000000n, k: parseUnits('0.5', 18), minMean: parseUnits('1', 18), maxMean: parseUnits('1000', 18), minSigma: parseUnits('0.2', 18), maxSigma: parseUnits('20', 18), minOutcome: parseUnits('1', 18), maxOutcome: parseUnits('1000', 18), closeAt: BigInt(proof.closeAt), resolveBy: BigInt(proof.resolveBy) };
  await operator.call('approve:expiry', manifest.tokenAddress, operator.tokenAbi, 'approve', [address, 1000000n]);
  const receipt = await operator.call('create:expiry', address, abi, 'createMarket', [config, { mean: parseUnits(proof.initialMean, 18), sigma: parseUnits('1', 18) }], 1000000n);
  proof.marketId = event(receipt, 'MarketCreated').args.marketId.toString(); proof.transactions.push({ action: 'Sponsor actual expiry market', hash: receipt.transactionHash }); save();
}
const id = BigInt(proof.marketId);
if (!proof.receiptId) {
  await trader.call('approve:expiry', manifest.tokenAddress, trader.tokenAbi, 'approve', [address, 1000000n]);
  const market = await client.readContract({ address, abi, functionName: 'getMarket', args: [id] });
  const receipt = await trader.call('trade:expiry', address, abi, 'trade', [id, { mean: market.currentCurve.mean + parseUnits('0.1', 18), sigma: parseUnits('1.1', 18) }, market.nonce, 1000000n, BigInt(proof.closeAt) - 1n], 1000000n);
  proof.receiptId = event(receipt, 'CurveChanged').args.receiptId.toString(); proof.transactions.push({ action: 'Forecast before real close', hash: receipt.transactionHash }); proof.stage = 'awaiting-expiry'; save();
}
if ((await client.getBlock()).timestamp < BigInt(proof.resolveBy)) {
  console.log(`Actual recovery market #${proof.marketId} is funded and traded. Permissionless cancellation begins ${new Date(proof.resolveBy * 1000).toISOString()}.`);
  process.exit(0);
}
const cancelled = await stranger.call('cancel:expiry', address, abi, 'cancelExpired', [id]);
proof.transactions.push({ action: 'Cancel from a non-resolver wallet', hash: cancelled.transactionHash });
const claimed = await trader.call('claim:expiry', address, abi, 'claim', [BigInt(proof.receiptId)]);
assert.equal(event(claimed, 'PositionClaimed').args.amount, 1000000n);
proof.transactions.push({ action: 'Trader original-deposit refund', hash: claimed.transactionHash });
const sponsorClaim = await operator.call('claim-sponsor:expiry', address, abi, 'claimSponsor', [id]);
assert.equal(event(sponsorClaim, 'SponsorClaimed').args.amount, 1000000n);
proof.transactions.push({ action: 'Sponsor original-backing refund', hash: sponsorClaim.transactionHash });
const [market, liability, tokenBalance] = await Promise.all([
  client.readContract({ address, abi, functionName: 'getMarket', args: [id] }),
  client.readContract({ address, abi, functionName: 'totalLiability' }),
  client.readContract({ address: manifest.tokenAddress, abi: operator.tokenAbi, functionName: 'balanceOf', args: [address] }),
]);
assert.equal(market.status, 2); assert.equal(market.paid, market.deposited); assert.equal(tokenBalance, liability);
proof.stage = 'cancelled-and-fully-refunded'; proof.checkedAt = new Date().toISOString(); proof.conservation = { paidMicro: market.paid.toString(), depositedMicro: market.deposited.toString(), traderRefundMicro: '1000000', sponsorRefundMicro: '1000000', contractTokenBalanceMicro: tokenBalance.toString(), totalLiabilityMicro: liability.toString(), matches: true };
proof.transactions = [...new Map(proof.transactions.map(item => [item.hash, item])).values()]; save();
console.log(JSON.stringify(proof.conservation));
