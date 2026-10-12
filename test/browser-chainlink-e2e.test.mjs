import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionMarketRules, testMarketRules, verifySignedTransaction } from '../scripts/browser-chainlink-e2e.mjs';
import { chainlinkPolicy } from '../scripts/chainlink-oracle.mjs';

test('live E2E rules commit a future source observation and both chain identities', () => {
  const rules = testMarketRules(chainlinkPolicy('arc-testnet'), 1800000000);
  assert.equal(Date.parse(rules.observationAt) / 1000, 1800000030);
  assert.equal(rules.earliestRetrievalAt, rules.observationAt);
  assert.equal(rules.chainlink.chainId, 5042);
  assert.equal(rules.chainlink.settlementChainId, 5042002);
  assert.match(rules.source, /explorer\.arc\.io/);
});

test('direction E2E rules bind a five-minute window and explicit tie outcome', () => {
  const rules = directionMarketRules(chainlinkPolicy('arc-testnet'), 1800000000);
  assert.equal(Date.parse(rules.windowEnd) - Date.parse(rules.windowStart), 300000);
  assert.equal(rules.observationAt, rules.windowEnd);
  assert.equal(rules.tiePolicy, 'Up when end price is equal to or greater than start price; Down only when lower.');
  assert.deepEqual(rules.binaryOutcomes, [{ outcome: 'Down', value: '0' }, { outcome: 'Up', value: '1' }]);
  assert.deepEqual(rules.normalization, { origin: '0', scale: '1' });
});

test('browser transaction reconciliation rejects wrong network, account, calldata, destination, value or nonce', () => {
  const request = { from: '0xabc', to: '0xdef', data: '0x1234', value: '0x0', nonce: '0x7' };
  const transaction = { chainId: 5042002, from: request.from, to: request.to, input: request.data, value: 0n, nonce: 7 };
  verifySignedTransaction(transaction, request);
  for (const change of [{ chainId: 5042 }, { from: '0xother' }, { to: '0xother' }, { input: '0xffff' }, { value: 1n }, { nonce: 8 }]) assert.throws(() => verifySignedTransaction({ ...transaction, ...change }, request));
  verifySignedTransaction({ ...transaction, to: null }, { ...request, to: undefined });
});
