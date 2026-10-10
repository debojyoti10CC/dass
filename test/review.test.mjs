import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withReviewDeadline } from '../web/src/review.ts';

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
