import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertMainnetReleaseGate, collectReleaseEvidence } from '../scripts/release-gate.mjs';

const gate = JSON.parse(fs.readFileSync('deployments/mainnet-release-gate.json', 'utf8'));
const build = JSON.parse(fs.readFileSync('deployments/arc-testnet-build-evidence.json', 'utf8'));
const tests = JSON.parse(fs.readFileSync('deployments/arc-testnet-test-evidence.json', 'utf8'));
const resolution = JSON.parse(fs.readFileSync('deployments/arc-testnet-resolution-evidence.json', 'utf8'));
const temporary = fs.mkdtempSync(path.resolve('work/release-gate-'));
fs.mkdirSync(path.join(temporary, 'web/public'), { recursive: true });
const files = new Set(['deployments/mainnet-release-gate.json', ...Object.keys(gate.evidenceSha256), ...Object.keys(build.webSourceFiles), ...Object.keys(tests.sourceFiles), resolution.evidencePath, `${path.dirname(resolution.evidencePath)}/source.json`]);
for (const file of files) {
  fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
  fs.copyFileSync(file, path.join(temporary, file));
}
function altered(file, mutate, assertion) {
  const target = path.join(temporary, file), original = fs.readFileSync(target);
  try { fs.writeFileSync(target, mutate(original)); assertion(); }
  finally { fs.writeFileSync(target, original); }
}
function jsonMutation(file, mutate, assertion) {
  altered(file, bytes => { const value = JSON.parse(bytes); mutate(value); return JSON.stringify(value); }, assertion);
}
test('Completed public evidence matches reviewed source; a different compiled bundle is rejected', () => {
  assertMainnetReleaseGate({ root: temporary, sourceSha256: gate.sourceSha256 });
  assert.throws(() => assertMainnetReleaseGate({ root: temporary, sourceSha256: 'changed' }), /Compiled source differs/);
});
test('A contract edit invalidates recorded test and security evidence', () => {
  altered('contracts/src/GaussianMath.sol', bytes => `${bytes}\n// changed\n`, () => assert.throws(() => collectReleaseEvidence(temporary), /Source changed/));
});
test('Refund mismatch and missing production browser proof block mainnet', () => {
  jsonMutation('deployments/arc-testnet-expiry-evidence.json', value => { value.conservation.paidMicro = '1'; }, () => assert.throws(() => collectReleaseEvidence(temporary), /Settlement did not conserve/));
  jsonMutation('deployments/arc-testnet-browser-evidence.json', value => { value.productionBuild = false; }, () => assert.throws(() => collectReleaseEvidence(temporary), /compiled production frontend/));
});
test('Untriaged findings block mainnet even when the scan succeeded', () => {
  jsonMutation('deployments/arc-testnet-security-evidence.json', value => { value.untriagedFindings = 1; }, () => assert.throws(() => collectReleaseEvidence(temporary)));
});
test('Changed evidence must be explicitly evaluated and recorded again', () => {
  jsonMutation('deployments/arc-testnet-browser-evidence.json', value => { value.checkedAt = 'changed'; }, () => assert.throws(() => assertMainnetReleaseGate({ root: temporary }), /Evidence changed/));
});
after(() => {
  const base = path.resolve('work') + path.sep;
  assert.ok(temporary.startsWith(base), 'Only remove the verified temporary work directory');
  fs.rmSync(temporary, { recursive: true });
});
