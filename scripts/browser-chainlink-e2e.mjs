import fs from 'node:fs';
import httpServer from 'node:http';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, defineChain, http, encodeDeployData, encodeFunctionData, decodeEventLog, erc20Abi, keccak256, toBytes, toHex, parseUnits, formatUnits } from 'viem';
import { canonical } from './public-runtime.mjs';
import { chainlinkPolicy, chainlinkSource, chainlinkClient, readChainlink } from './chainlink-oracle.mjs';
import { resolveCoinbase } from './resolve-coinbase.mjs';

const WAD = 10n ** 18n, MICRO = 1000000n;
const expectedAccount = '0x7e8279CFE2c20C37EaD44a80517FdBb430ACA047';
const directionMode = process.argv.includes('--direction');
const file = directionMode ? 'deployments/arc-testnet-browser-btc-direction-e2e.json' : 'deployments/arc-testnet-browser-chainlink-e2e.json';
const resolutionFile = directionMode ? 'deployments/arc-testnet-browser-btc-direction-resolution.json' : 'deployments/arc-testnet-browser-chainlink-resolution.json';
const catalogFile = file;
const journalFile = directionMode ? 'work/arc-testnet-browser-btc-direction-transactions.json' : 'work/arc-testnet-browser-chainlink-transactions.json';

export function testMarketRules(policy, closeAt) {
  const observationAt = new Date((closeAt + 30) * 1000).toISOString();
  return { question: `BTC/USD Chainlink · ${observationAt} · live testnet E2E`, category: 'Crypto', chainlink: policy, source: chainlinkSource(policy),
    field: 'latestRoundData().answer at the first source-chain block at or after observationAt, using the committed feed decimals.', observationAt, earliestRetrievalAt: observationAt,
    publicationPolicy: 'Use the first source-chain block at or after observationAt and verify its predecessor is earlier. Require a positive complete BTC/USD round, no future update and age within maxAgeSeconds. Re-read the archived block and round before signing. No exchange fallback or later-price substitution.',
    units: 'USD / 1000', normalization: { origin: '0', scale: '1000' }, precision: 'Chainlink feed decimals; normalized outcomeStep 0.000001 (0.001 USD).', rounding: 'Normalize once; nearest step, exact halves away from zero.',
    missingData: 'Unavailable historical state, invalid/stale feed or out-of-bounds outcome blocks resolution. Cancel at resolveBy for original-deposit refunds.',
    evidencePolicy: 'Archive feed/chain identity, round fields and block number/hash/timestamp. Re-read onchain and recompute normalization before signing; commit canonical evidence keccak256.',
    resolverModel: `Trusted browser operator reads Chainlink on chain ${policy.chainId}, settles on chain ${policy.settlementChainId ?? policy.chainId}. No verified cross-chain relay or native testnet feed is claimed.`,
    initialForecastPolicy: 'Sponsor forecast initialized at the live Chainlink price, not externally supplied odds.',
  };
}

export function directionMarketRules(policy, closeAt) {
  const iso = seconds => new Date(seconds * 1000).toISOString();
  const windowStart = iso(closeAt), windowEnd = iso(closeAt + 300);
  return {
    kind: 'btc-five-minute-direction', question: `BTC up or down · ${windowStart.slice(0, 16).replace('T', ' ')}–${windowEnd.slice(11, 16)} UTC`, category: 'Crypto',
    chainlink: policy, source: chainlinkSource(policy), windowStart, windowEnd, observationAt: windowEnd, earliestRetrievalAt: windowEnd,
    field: 'Compare the positive latestRoundData().answer from the first confirmed source-chain block at or after each window boundary, using the committed feed decimals.',
    publicationPolicy: 'Sample BTC/USD Chainlink at the first confirmed source-chain block at or after windowStart and windowEnd, whose committed boundaries are 300 seconds apart. Up if end answer is greater than or equal to start answer; Down only if lower. No exchange fallback or later-price substitution.',
    units: 'BTC direction', normalization: { origin: '0', scale: '1' }, precision: 'Binary outcome: 0=Down, 1=Up; end price equal to start price resolves Up.',
    rounding: 'No rounding; compare the exact positive integer Chainlink answers.', tiePolicy: 'Up when end price is equal to or greater than start price; Down only when lower.',
    binaryOutcomes: [{ outcome: 'Down', value: '0' }, { outcome: 'Up', value: '1' }],
    missingData: 'Missing feed, historical RPC state, invalid/stale round or out-of-bounds value blocks resolution. Anyone can cancel at expiry for original-deposit refunds.',
    evidencePolicy: 'Archive both exact feed round snapshots and their source-chain block hashes; verify each snapshot against historical chain state before signing and commit the canonical evidence hash.',
    resolverModel: `Trusted browser operator reads Chainlink on chain ${policy.chainId}, settles on chain ${policy.settlementChainId ?? policy.chainId}. This is an off-chain read, not a verified cross-chain relay. The market trusts its resolver wallet.`,
    initialForecastPolicy: 'The initial curve is a neutral midpoint forecast, not external odds. Every later curve is read from confirmed onchain state.',
  };
}

export function verifySignedTransaction(transaction, request) {
  assert.equal(transaction.chainId, 5042002, 'Only Arc testnet signing is allowed.');
  assert.equal(transaction.from.toLowerCase(), request.from.toLowerCase(), 'Unexpected signer.');
  assert.equal(transaction.to?.toLowerCase(), request.to?.toLowerCase(), 'Unexpected destination.');
  assert.equal(transaction.input.toLowerCase(), request.data.toLowerCase(), 'Unexpected calldata.');
  assert.equal(transaction.value, BigInt(request.value), 'Unexpected transferred value.');
  assert.equal(transaction.nonce, Number(BigInt(request.nonce)), 'Unexpected transaction nonce.');
}

async function run() {
  const previous = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
  const artifact = JSON.parse(fs.readFileSync('work/artifacts/DistributionMarkets.json', 'utf8'));
  const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [previous.rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(previous.rpcUrl, { timeout: 20000, retryCount: 1 }), pollingInterval: 1000 });
  const preparer = createWalletClient({ chain, account: expectedAccount, transport: http(previous.rpcUrl) });
  assert.equal(await client.getChainId(), chain.id);
  const policy = chainlinkPolicy('arc-testnet'), oracle = chainlinkClient(policy, client, chain.id);
  const prior = await readChainlink(oracle, policy, await oracle.getBlock());
  const sample = testMarketRules(policy, 1800000000);
  assert.equal(Date.parse(sample.observationAt) / 1000, 1800000030);
  assert.equal(sample.chainlink.settlementChainId, chain.id);
  const balance = await client.getBalance({ address: expectedAccount });
  assert.ok(balance >= 3n * WAD, 'At least 3 test USDC required for two deposits plus fees.');
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ preflightPassed: true, operator: expectedAccount, balanceUSDC: formatUnits(balance, 18), sourceChainId: policy.chainId, settlementChainId: chain.id, rawValue: prior.rawValue, signing: 'Browser approval required; no transactions sent.' }, null, 2));
    return;
  }
  let proof = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { chainId: chain.id, operator: expectedAccount, previousContract: previous.address, tokenAddress: previous.tokenAddress, transactions: [], markets: [], stage: 'prepared' };
  assert.equal(proof.chainId, chain.id); assert.equal(proof.operator.toLowerCase(), expectedAccount.toLowerCase());
  const save = () => fs.writeFileSync(file, JSON.stringify(proof, null, 2) + '\n');
  const journal = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : [];
  const saveJournal = () => fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2) + '\n');
  const sessionToken = randomBytes(32).toString('hex');
  let pending, connectedResolve;
  const connected = new Promise(resolve => connectedResolve = resolve);
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Arc testnet Chainlink E2E</title><style>body{font:18px system-ui;max-width:850px;margin:50px auto;padding:24px}button,select{font:inherit;padding:12px;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;padding:20px}</style></head><body><h1>Live Chainlink test on Arc testnet</h1><p>Deploy one new contract, back one BTC market with 1 test USDC, trade 1 test USDC, resolve and claim both payouts. Mainnet is read-only.</p><p>Required account: ${expectedAccount}</p><button id="connect">Connect Core testnet wallet</button><p id="status">Not connected.</p><h2 id="action">Waiting for wallet</h2><pre id="details"></pre><button id="sign" disabled>Sign testnet transaction</button><script>
const token=${JSON.stringify(sessionToken)}, account=${JSON.stringify(expectedAccount)}, rpc=${JSON.stringify(previous.rpcUrl)};
const status=document.querySelector('#status'), sign=document.querySelector('#sign');let provider, state, busy=false;
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'x-session-token':token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error);return v}
document.querySelector('#connect').onclick=async()=>{try{provider=window.avalanche;if(!provider)throw Error('No wallet found');const a=await provider.request({method:'eth_requestAccounts'});if(a[0]?.toLowerCase()!==account.toLowerCase())throw Error('Select the required funded operator account in your wallet');try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x4cef52'}]})}catch(e){if(e.code!==4902)throw e;await provider.request({method:'wallet_addEthereumChain',params:[{chainId:'0x4cef52',chainName:'Arc Testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:[rpc],blockExplorerUrls:['https://explorer.testnet.arc.io']}]})}const chain=await provider.request({method:'eth_chainId'});if(Number(BigInt(chain))!==5042002)throw Error('Wrong wallet chain');await api('/connected',{account:a[0],chainId:5042002});status.textContent='Connected '+a[0]+' on Arc testnet';document.querySelector('#connect').disabled=true}catch(e){status.textContent=e.message}};
sign.onclick=async()=>{busy=true;sign.disabled=true;try{const a=await provider.request({method:'eth_accounts'});const chain=await provider.request({method:'eth_chainId'});if(a[0]?.toLowerCase()!==account.toLowerCase()||Number(BigInt(chain))!==5042002)throw Error('Wallet account/network changed');const hash=await provider.request({method:'eth_sendTransaction',params:[state.request]});await api('/signed',{hash});status.textContent='Submitted '+hash}catch(e){status.textContent=e.message}finally{busy=false}};
setInterval(async()=>{try{state=await api('/state');document.querySelector('#action').textContent=state.action??state.stage;document.querySelector('#details').textContent=JSON.stringify(state.request??state.summary,null,2);sign.disabled=!provider||!state.request||busy}catch(e){status.textContent=e.message}},1000);
</script></body></html>`;
  const server = httpServer.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.headers.host !== '127.0.0.1:8791') return reply(403, { error: 'Local host required.' });
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(page); return; }
    if (req.headers['x-session-token'] !== sessionToken || (req.method === 'POST' && req.headers.origin !== 'http://127.0.0.1:8791')) return reply(403, { error: 'Local session required.' });
    if (req.method === 'GET' && req.url === '/state') return reply(200, pending ? { action: pending.action, request: pending.request } : { stage: proof.stage, summary: { contract: proof.contract, marketId: proof.markets[0]?.marketId, observationAt: proof.markets[0]?.rules.observationAt, conservation: proof.conservation } });
    if (req.method !== 'POST' || !['/connected', '/signed'].includes(req.url)) return reply(404, { error: 'Unknown request.' });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 1024) return reply(413, { error: 'Request too large.' }); }
    try {
      const data = JSON.parse(body);
      if (req.url === '/connected') {
        assert.equal(data.account.toLowerCase(), expectedAccount.toLowerCase()); assert.equal(data.chainId, chain.id);
        connectedResolve(); return reply(200, { connected: true });
      }
      assert.ok(pending, 'No pending transaction.'); assert.match(data.hash, /^0x[0-9a-fA-F]{64}$/);
      pending.record.hash = data.hash; pending.record.state = 'submitted'; saveJournal();
      const done = pending.resolve; pending = undefined; done(data.hash); reply(200, { recorded: true });
    } catch (error) { reply(400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8791, '127.0.0.1', resolve); });
  console.log('Browser signer ready: http://127.0.0.1:8791');
  try {
    await connected;
    const confirm = async record => {
      const transaction = await client.getTransaction({ hash: record.hash }); verifySignedTransaction(transaction, record.request);
      const receipt = await client.waitForTransactionReceipt({ hash: record.hash, timeout: 60000 });
      record.state = receipt.status === 'success' ? 'confirmed' : 'reverted'; saveJournal();
      assert.equal(receipt.status, 'success', `${record.action} reverted.`);
      if (!proof.transactions.some(t => t.hash === receipt.transactionHash)) { proof.transactions.push({ action: record.action, hash: receipt.transactionHash, blockNumber: String(receipt.blockNumber), feeNativeRaw: String(receipt.gasUsed * receipt.effectiveGasPrice) }); save(); }
      return receipt;
    };
    const send = async (action, transaction, deposit = 0n) => {
      const old = journal.find(r => r.action === action);
      if (old) { assert.equal(old.inputHash, keccak256(transaction.data)); assert.equal(old.request.to?.toLowerCase(), transaction.to?.toLowerCase()); if (!old.hash) throw new Error(`Reconcile ${action} at nonce ${old.request.nonce} before retrying.`); return confirm(old); }
      assert.equal(await client.getChainId(), chain.id);
      assert.ok(!journal.some(r => !['confirmed', 'reverted'].includes(r.state)), 'Reconcile outstanding transactions first.');
      const estimate = await client.estimateGas({ account: expectedAccount, ...transaction });
      const gas = (estimate * 120n + 99n) / 100n, gasPrice = (await client.getGasPrice()) * 125n / 100n;
      const reserve = gas * gasPrice;
      assert.ok(reserve <= WAD, 'Transaction fee cap is 1 test USDC.');
      assert.ok(await client.getBalance({ address: expectedAccount }) >= deposit * 10n ** 12n + reserve, 'Insufficient test USDC.');
      const prepared = await preparer.prepareTransactionRequest({ ...transaction, gas, gasPrice, type: 'legacy', value: 0n });
      const request = { from: expectedAccount, ...(transaction.to ? { to: transaction.to } : {}), data: transaction.data, value: '0x0', chainId: toHex(chain.id), gas: toHex(gas), gasPrice: toHex(gasPrice), nonce: toHex(prepared.nonce) };
      const record = { action, request, inputHash: keccak256(transaction.data), state: 'awaiting-wallet' }; journal.push(record); saveJournal();
      await new Promise(resolve => { pending = { action, request, record, resolve }; });
      return confirm(record);
    };
    const call = async (action, address, abi, functionName, args, deposit = 0n) => {
      if (!journal.some(r => r.action === action)) await client.simulateContract({ account: expectedAccount, address, abi, functionName, args });
      return send(action, { to: address, data: encodeFunctionData({ abi, functionName, args }) }, deposit);
    };
    const event = (receipt, name) => { const e = receipt.logs.map(log => { try { return decodeEventLog({ abi: artifact.abi, ...log }); } catch { return null; } }).find(e => e?.eventName === name); assert.ok(e, `Missing ${name}.`); return e.args; };
    if (!proof.contract) {
      const receipt = await send('Deploy browser-operator test contract', { data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [previous.tokenAddress, expectedAccount] }) });
      assert.ok(receipt.contractAddress); proof.contract = receipt.contractAddress; proof.deploymentTransaction = receipt.transactionHash; save();
    }
    assert.equal((await client.readContract({ address: proof.contract, abi: artifact.abi, functionName: 'operator' })).toLowerCase(), expectedAccount.toLowerCase());
    assert.equal((await client.readContract({ address: proof.contract, abi: artifact.abi, functionName: 'token' })).toLowerCase(), previous.tokenAddress.toLowerCase());
    if (!proof.markets.length) {
      const block = await client.getBlock(), closeAt = directionMode ? (Math.floor(Number(block.timestamp) / 300) + 2) * 300 : Number(block.timestamp) + 300;
      const current = await readChainlink(oracle, policy, await oracle.getBlock());
      const initialMeanWad = directionMode ? WAD / 2n : parseUnits(current.rawValue, 18) / 1000n;
      proof.markets.push({ slug: directionMode ? `btc-up-down-e2e-${closeAt}` : `btc-chainlink-e2e-${closeAt}`, closeAt, resolveBy: closeAt + (directionMode ? 3900 : 3600), initialMeanWad: String(initialMeanWad), initialSigmaWad: directionMode ? String(WAD / 2n) : String(WAD), rules: directionMode ? directionMarketRules(policy, closeAt) : testMarketRules(policy, closeAt), ...(directionMode ? {} : { initialPriceSource: current.snapshot }) }); save();
    }
    const item = proof.markets[0], rawRules = JSON.stringify(canonical(item.rules));
    const rulesHash = keccak256(toBytes(rawRules));
    if (!item.marketId) {
      await call('Approve sponsor backing', previous.tokenAddress, erc20Abi, 'approve', [proof.contract, MICRO]);
      const config = { resolver: expectedAccount, rulesHash, rulesURI: `data:application/json;base64,${Buffer.from(rawRules).toString('base64')}`, units: item.rules.units, origin: 0n, scale: directionMode ? WAD : 1000n * WAD, outcomeStep: directionMode ? WAD : 1000000000000n, backing: MICRO, k: WAD / 2n, minMean: directionMode ? 0n : WAD, maxMean: directionMode ? WAD : 1000n * WAD, minSigma: directionMode ? WAD / 2n : WAD / 5n, maxSigma: directionMode ? WAD / 2n : 20n * WAD, minOutcome: directionMode ? 0n : WAD, maxOutcome: directionMode ? WAD : 1000n * WAD, closeAt: BigInt(item.closeAt), resolveBy: BigInt(item.resolveBy) };
      const receipt = await call(directionMode ? 'Create live BTC direction market' : 'Create live BTC Chainlink market', proof.contract, artifact.abi, 'createMarket', [config, { mean: BigInt(item.initialMeanWad), sigma: BigInt(item.initialSigmaWad ?? WAD) }], MICRO);
      item.marketId = String(event(receipt, 'MarketCreated').marketId); item.rulesHash = rulesHash; item.creationTransaction = receipt.transactionHash; save();
      fs.writeFileSync(`web/public/rules/${item.slug}.json`, rawRules);
    }
    const id = BigInt(item.marketId), market = () => client.readContract({ address: proof.contract, abi: artifact.abi, functionName: 'getMarket', args: [id] });
    assert.equal((await market()).rulesHash, rulesHash);
    if (!proof.receiptId) {
      await call('Approve trader deposit', previous.tokenAddress, erc20Abi, 'approve', [proof.contract, MICRO]);
      const receipt = await call(directionMode ? 'Trade live BTC direction' : 'Trade live BTC distribution', proof.contract, artifact.abi, 'trade', [id, { mean: directionMode ? WAD : BigInt(item.initialMeanWad) + WAD / 20n, sigma: directionMode ? WAD / 2n : WAD * 9n / 10n }, 0n, MICRO, BigInt(item.closeAt - 1)], MICRO);
      proof.receiptId = String(event(receipt, 'CurveChanged').receiptId); proof.stage = 'traded-awaiting-observation'; save();
    }
    const current = await market(); assert.equal(current.deposited, 2n * MICRO);
    const observationEnd = directionMode ? item.closeAt + 300 : item.closeAt + 30;
    while ((await client.getBlock()).timestamp < BigInt(observationEnd)) { console.log(`Waiting for real observation ${item.rules.observationAt}`); await new Promise(resolve => setTimeout(resolve, 30000)); }
    await assert.rejects(client.simulateContract({ account: expectedAccount, address: proof.contract, abi: artifact.abi, functionName: 'trade', args: [id, { mean: BigInt(item.initialMeanWad), sigma: WAD }, 1n, MICRO, BigInt(item.resolveBy)] }));
    proof.lateTradeRejected = true;
    const manifest = { ...previous, address: proof.contract, operator: expectedAccount };
    const runtime = { manifest, account: { address: expectedAccount }, client, abi: artifact.abi, call };
    await resolveCoinbase({ runtime, oracleClient: oracle, catalogFile, resolutionFile });
    proof.stage = 'resolved'; save();
    const traderClaim = await call('Claim trader payout', proof.contract, artifact.abi, 'claim', [BigInt(proof.receiptId)]);
    proof.traderPayoutMicro = String(event(traderClaim, 'PositionClaimed').amount); save();
    const sponsorClaim = await call('Claim sponsor payout', proof.contract, artifact.abi, 'claimSponsor', [id]);
    proof.sponsorPayoutMicro = String(event(sponsorClaim, 'SponsorClaimed').amount); save();
    const [settled, liability, tokenBalance, receiptRecord] = await Promise.all([market(), client.readContract({ address: proof.contract, abi: artifact.abi, functionName: 'totalLiability' }), client.readContract({ address: previous.tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [proof.contract] }), client.readContract({ address: proof.contract, abi: artifact.abi, functionName: 'getReceipt', args: [BigInt(proof.receiptId)] })]);
    assert.equal(settled.status, 1); assert.equal(settled.paid, settled.deposited); assert.equal(tokenBalance, liability); assert.equal(liability, 0n); assert.equal(receiptRecord.claimed, true); assert.equal(settled.sponsorClaimed, true);
    assert.equal(BigInt(proof.traderPayoutMicro) + BigInt(proof.sponsorPayoutMicro), 2n * MICRO);
    proof.conservation = { depositedMicro: String(settled.deposited), paidMicro: String(settled.paid), totalLiabilityMicro: String(liability), contractTokenBalanceMicro: String(tokenBalance), matches: true };
    proof.stage = 'resolved-and-fully-claimed'; proof.checkedAt = new Date().toISOString(); save();
    console.log(JSON.stringify(proof, null, 2));
    console.log('E2E complete. Browser page remains open for review.');
  } catch (error) { proof.stage = `blocked: ${error.message}`; save(); console.error(error); }
}

if (process.argv[1]?.endsWith('browser-chainlink-e2e.mjs')) await run();
