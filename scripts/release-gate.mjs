import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { keccak256 } from 'viem';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const evidenceNames = ['arc-testnet.json', 'arc-testnet-deployment-evidence.json', 'arc-testnet-verification-evidence.json', 'arc-testnet-test-evidence.json', 'arc-testnet-security-evidence.json', 'arc-testnet-acceptance-evidence.json', 'arc-testnet-resolution-evidence.json', 'arc-testnet-expiry-evidence.json', 'arc-testnet-browser-evidence.json', 'arc-testnet-build-evidence.json', 'arc-testnet-review-evidence.json', 'arc-testnet-rpc-evidence.json'];
export function webFingerprints(root = '.') {
  const files = ['web/package.json', 'web/index.html', 'web/vite.config.ts', 'package-lock.json'];
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (['web/public/rules', 'web/public/evidence'].includes(name)) continue;
      if (entry.isDirectory()) walk(name); else files.push(name);
    }
  }
  walk('web/src'); walk('web/public');
  return Object.fromEntries(files.sort().map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    // Deployment selection changes only the generated import; ABI content must still match.
    const content = file === 'web/src/contracts.ts' ? bytes.toString().replace(/^import manifest from .*;$/m, 'import manifest from <deployment>;') : bytes;
    return [file, digest(content)];
  }));
}

/** Technical testnet prerequisite, not an independent audit or financial approval. */
export function collectReleaseEvidence(root = '.') {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, 'deployments', file), 'utf8'));
  const [manifest, deployment, verification, tests, security, acceptance, resolution, expiry, browser, build, review, rpc] = evidenceNames.map(read);
  const address = manifest.address?.toLowerCase();
  assert.equal(manifest.chainId, 5042002, 'Public Arc Testnet required');
  assert.equal(manifest.status, 'deployed');
  assert.match(address ?? '', /^0x[0-9a-f]{40}$/);
  assert.notEqual(address, `0x${'0'.repeat(40)}`);
  for (const evidence of [deployment, acceptance, resolution, expiry, browser]) {
    assert.equal((evidence.contract ?? evidence.address)?.toLowerCase(), address, 'Evidence contract mismatch');
    if (evidence.chainId !== undefined) assert.equal(evidence.chainId, manifest.chainId);
  }
  assert.equal(deployment.status, 'success');
  assert.equal(deployment.sourceSha256, manifest.sourceSha256);
  assert.equal(verification.address.toLowerCase(), address);
  assert.equal(verification.status.result, 'Pass - Verified');
  assert.equal(tests.passed, true);
  assert.ok(tests.nodeTestsPassed >= 16 && tests.forgeTestsPassed >= 10 && tests.fuzzRuns >= 768 && tests.numericFixtures >= 189);
  assert.equal(security.successfulAnalysis, true);
  assert.equal(security.highFindings, 0);
  assert.equal(security.untriagedFindings, 0);
  assert.ok(security.findings.every(finding => finding.disposition?.startsWith('Reviewed:')));
  for (const proof of [tests, security]) {
    for (const [file, fingerprint] of Object.entries(proof.sourceFiles)) {
      assert.equal(digest(fs.readFileSync(path.join(root, file))), fingerprint, `Source changed since ${proof === tests ? 'tests' : 'review'}: ${file}`);
    }
  }
  assert.equal(acceptance.stage, 'resolved-and-fully-claimed');
  assert.equal(acceptance.staleNonceRejected, true);
  assert.notEqual(acceptance.wallets['trader-a'].toLowerCase(), acceptance.wallets['trader-b'].toLowerCase());
  assert.equal(expiry.stage, 'cancelled-and-fully-refunded');
  for (const proof of [acceptance, expiry]) {
    assert.equal(proof.conservation.matches, true);
    assert.equal(proof.conservation.paidMicro, proof.conservation.depositedMicro, 'Settlement did not conserve deposits');
    assert.equal(proof.conservation.contractTokenBalanceMicro, proof.conservation.totalLiabilityMicro, 'Escrow mismatch');
  }
  assert.equal(resolution.marketId, acceptance.marketId);
  assert.match(resolution.evidencePath, /^web\/public\/evidence\/[a-zA-Z0-9-]+\/evidence\.json$/);
  const evidenceBytes = fs.readFileSync(path.join(root, resolution.evidencePath));
  assert.equal(keccak256(evidenceBytes), resolution.evidenceHash);
  assert.equal(digest(fs.readFileSync(path.join(root, path.dirname(resolution.evidencePath), 'source.json'))), resolution.sourceSha256);
  assert.equal(browser.passed, true);
  assert.equal(browser.productionBuild, true, 'Test the compiled production frontend');
  assert.equal(build.passed, true);
  assert.equal(build.productionAuditVulnerabilities, 0);
  assert.deepEqual(build.webSourceFiles, webFingerprints(root), 'Frontend changed after its build');
  assert.equal(review.passed, true, 'Forecast review recovery must pass');
  assert.equal(review.contract.toLowerCase(), address);
  assert.equal(review.chainId, manifest.chainId);
  assert.deepEqual(review.webSourceFiles, webFingerprints(root), 'Frontend changed after review recovery checks');
  assert.equal(rpc.passed, true);
  assert.equal(rpc.chainId, manifest.chainId);
  assert.equal(rpc.contract.toLowerCase(), address);
  assert.equal(rpc.runtimeCodeHash, deployment.runtimeCodeHash, 'Secondary RPC deployed code differs');
  return { contract: manifest.address, chainId: manifest.chainId, sourceSha256: manifest.sourceSha256,
    evidenceSha256: Object.fromEntries(evidenceNames.map(file => [`deployments/${file}`, digest(fs.readFileSync(path.join(root, 'deployments', file)))])) };
}

export function assertMainnetReleaseGate({ root = '.', sourceSha256 } = {}) {
  const gate = JSON.parse(fs.readFileSync(path.join(root, 'deployments/mainnet-release-gate.json'), 'utf8'));
  assert.equal(gate.testnetPrerequisitesPassed, true);
  const current = collectReleaseEvidence(root);
  assert.equal(gate.contract, current.contract);
  assert.equal(gate.sourceSha256, current.sourceSha256);
  assert.deepEqual(gate.evidenceSha256, current.evidenceSha256, 'Evidence changed; re-evaluate the release gate');
  if (sourceSha256) assert.equal(sourceSha256, gate.sourceSha256, 'Compiled source differs from verified and tested deployment');
  return gate;
}

if (process.argv[1]?.endsWith('release-gate.mjs')) {
  if (process.argv.includes('--record')) {
    const evidence = collectReleaseEvidence();
    fs.writeFileSync('deployments/mainnet-release-gate.json', JSON.stringify({ checkedAt: new Date().toISOString(), testnetPrerequisitesPassed: true, ...evidence,
      independentAudit: false, resolverModel: 'Trusted project operator', mainnetDeployed: false,
      limitations: ['In-house review and automated scan; no independent audit', 'Manual assistive-technology review pending', 'Mainnet funding, deployment, live wallet acceptance and public hosting/source are separate requirements'] }, null, 2) + '\n');
    console.log('Public testnet prerequisites recorded for the exact reviewed source and evidence. Mainnet is not deployed.');
  } else { assertMainnetReleaseGate(); console.log('Release evidence and source fingerprints match.'); }
}
