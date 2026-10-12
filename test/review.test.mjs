import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withReadDeadline, withReviewDeadline } from '../web/src/review.ts';

test('an unresponsive read ends preparation and a fresh review can succeed', async () => {
  await assert.rejects(withReviewDeadline(new Promise(() => {}), 20), /review timed out.*No approval or forecast transaction was requested/);
  assert.equal(await withReviewDeadline(Promise.resolve('fresh simulation'), 100), 'fresh simulation');
});

test('a late read cannot replace the timeout result with a usable review', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const review = withReviewDeadline(pending, 20);
  await assert.rejects(review, /review timed out/);
  finish('stale simulation');
  await assert.rejects(review, /review timed out/);
});

test('simulation errors retain their cause instead of becoming timeout errors', async () => {
  const failure = new Error('Insufficient shared USDC');
  await assert.rejects(withReviewDeadline(Promise.reject(failure), 100), error => error === failure);
});

test('approval preparation timeout cannot send a late wallet transaction', async () => {
  let finish, sends = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const action = (async () => { await withReadDeadline(pending, 'Approval preparation timed out', 20); sends++; })();
  await assert.rejects(action, /Approval preparation timed out/);
  finish('late approval simulation');
  await Promise.resolve();
  assert.equal(sends, 0);
});

test('post-approval and submission checks retain their distinct failure messages', async () => {
  await assert.rejects(withReadDeadline(new Promise(() => {}), 'Approval is confirmed; post-approval checks timed out', 20), /Approval is confirmed/);
  await assert.rejects(withReadDeadline(new Promise(() => {}), 'Forecast preparation timed out; no forecast requested', 20), /no forecast requested/);
});

import { validateEvidenceRules, validateRules } from '../web/src/rules.ts';
import { marketPageIds } from '../web/src/marketPage.ts';

test('evidence must match every committed rule semantic', () => {
  const rules = { source: 'source', field: 'close', observationAt: '2026-10-10T00:00:00Z', publicationPolicy: 'first', units: 'USD', normalization: { origin: '0', scale: '1' }, precision: '0.01', rounding: 'half away from zero' };
  const evidence = { ...rules, rulesHash: `0x${'12'.repeat(32)}` };
  validateEvidenceRules(evidence, rules, evidence.rulesHash);
  validateEvidenceRules({ ...evidence, normalization: { scale: '1', origin: '0' } }, rules, evidence.rulesHash);
  for (const field of Object.keys(evidence)) {
    assert.throws(() => validateEvidenceRules({ ...evidence, [field]: 'wrong' }, rules, evidence.rulesHash), /match/);
    const missing = { ...evidence }; delete missing[field];
    assert.throws(() => validateEvidenceRules(missing, rules, evidence.rulesHash), /match/);
  }
  assert.throws(() => validateEvidenceRules(null, rules, evidence.rulesHash), /JSON object/);
});

test('BTC direction rules and evidence preserve the window and binary settlement semantics', () => {
  const rules = {
    question: 'BTC up or down', source: 'https://example.test/feed', field: 'BTC/USD answer',
    observationAt: '2026-10-12T00:05:00Z', publicationPolicy: 'First confirmed sample', units: 'BTC direction',
    normalization: { origin: '0', scale: '1' }, precision: 'Binary', rounding: 'No rounding',
    missingData: 'Cancel at expiry', evidencePolicy: 'Archive source rounds',
    kind: 'btc-five-minute-direction', windowStart: '2026-10-12T00:00:00Z', windowEnd: '2026-10-12T00:05:00Z',
    earliestRetrievalAt: '2026-10-12T00:05:00Z', tiePolicy: 'Up when end price is equal to or greater than start price; Down only when lower.',
    binaryOutcomes: [{ outcome: 'Down', value: '0' }, { outcome: 'Up', value: '1' }],
  };
  validateRules(rules);
  const commitment = `0x${'34'.repeat(32)}`;
  const evidence = { ...rules, rulesHash: commitment };
  validateEvidenceRules(evidence, rules, commitment);
  for (const [field, value] of [['windowEnd', '2026-10-12T00:06:00Z'], ['tiePolicy', 'ties Down'], ['binaryOutcomes', [{ outcome: 'Up', value: '0' }]]]) {
    assert.throws(() => validateRules({ ...rules, [field]: value }), /BTC direction/);
    assert.throws(() => validateEvidenceRules({ ...evidence, [field]: value }, rules, commitment), /match/);
  }
});

test('market pages are bounded, descending, and cover every ID exactly once', () => {
  const pages = [0, 1, 2].map(page => marketPageIds(43n, page));
  assert.deepEqual(pages.map(page => page.length), [20, 20, 3]);
  assert.deepEqual(pages.flat(), Array.from({ length: 43 }, (_, index) => 43n - BigInt(index)));
  assert.deepEqual(marketPageIds(0n, 0), []);
  assert.deepEqual(marketPageIds(43n, 3), []);
  assert.throws(() => marketPageIds(43n, -1), /Invalid/);
});
