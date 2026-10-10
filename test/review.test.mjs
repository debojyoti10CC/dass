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
