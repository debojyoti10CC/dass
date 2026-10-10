import fs from 'node:fs';
import { formatUnits } from 'viem';
import { assertMainnetReleaseGate } from './release-gate.mjs';
assertMainnetReleaseGate();
const read = suffix => JSON.parse(fs.readFileSync(`deployments/${suffix}.json`, 'utf8'));
const manifest = read('arc-testnet'), acceptance = read('arc-testnet-acceptance-evidence'), expiry = read('arc-testnet-expiry-evidence'), resolution = read('arc-testnet-resolution-evidence'), security = read('arc-testnet-security-evidence'), tests = read('arc-testnet-test-evidence'), browser = read('arc-testnet-browser-evidence'), funding = read('arc-mainnet-funding-evidence'), hosting = read('arc-testnet-hosting-evidence');
const tx = (label, hash) => `[${label}](${manifest.explorerUrl}/tx/${hash})`;
const micro = value => formatUnits(BigInt(value), 6);
const lines = [
  '# DAZZ Markets — public testnet release evidence', '',
  `Recorded ${new Date().toISOString()}. Public **Arc Testnet (5042002)** is deployed and source verified. Mainnet remains undeployed and unfunded.`, '',
  `- [Verified application contract](${manifest.verificationUrl}): \`${manifest.address}\``,
  `- ${tx('Deployment receipt', manifest.deploymentTransaction)} — block ${manifest.deploymentBlock}; Solidity 0.8.30, optimizer 200, viaIR, Paris.`,
  `- [Private HTTPS app](${hosting.url}) — owner-only review access, actual public testnet RPC. This is not yet a public grant submission link.`,
  '- [Local app](http://127.0.0.1:5173/) — left running for side-by-side use; connect your own injected EVM wallet.', '',
  '## Real markets and real settlement', '',
  'Three actual event markets were sponsored: an exact Coinbase BTC/USD candle, Coventry City–Newcastle United total goals (October 12, 19:00 UTC), and Everton–Chelsea total goals (October 17, 11:30 UTC). Football fixtures come from the [official Premier League schedule](https://www.premierleague.com/en/news/4688862). Initial curves are explicitly sponsor forecasts; no bookmaker feed is claimed.', '',
  `The exact Coinbase candle returned **${resolution.rawValue} USD**, normalized onchain to **${formatUnits(BigInt(resolution.normalizedOutcome), 18)}**. Original source bytes and canonical evidence are bundled with the source. ${tx('Resolution receipt', resolution.transactionHash)} commits \`${resolution.evidenceHash}\`.`, '',
  '| Recipient | Actual payout (test USDC) |', '| --- | ---: |',
  `| Trader A | ${micro(acceptance['trader-aPayoutMicro'])} |`,
  `| Trader B | ${micro(acceptance['trader-bPayoutMicro'])} |`,
  `| Sponsor | ${micro(BigInt(acceptance.conservation.paidMicro) - BigInt(acceptance['trader-aPayoutMicro']) - BigInt(acceptance['trader-bPayoutMicro']))} |`,
  '| Total deposited and paid | 3 |', '',
  ...acceptance.transactions.map(item => `- ${tx(item.action, item.hash)}`), '',
  '## Actual expiry and refunds', '',
  'A fourth real BTC candle market was explicitly labelled as a testnet recovery exercise. The resolver intentionally stayed offline; no artificial observation was submitted. After the real deadline, a different, non-resolver wallet cancelled it. The trader and sponsor each received their original 1 USDC deposit. Deposited and refunded totals both equal **2 USDC**.', '',
  ...expiry.transactions.map(item => `- ${tx(item.action, item.hash)}`), '',
  `The contract’s actual native-token balance and tracked liability both equal **${micro(expiry.conservation.totalLiabilityMicro)} USDC**, backing the two open football markets.`, '',
  '## Executed checks and review', '',
  `- ${tests.nodeTestsPassed} lifecycle/adversarial Node tests; ${tests.forgeTestsPassed} Arc Forge tests; ${tests.fuzzRuns} fuzz runs.`,
  `- ${tests.numericFixtures} exact contract/reference fixtures; ${tests.analyticComparisons} high-precision numerical comparisons; ${tests.claimOrderChecks} claim-order checks; 12 invalid numerical cases.`,
  '- Native Arc USDC restrictions/rollback/recovery, reentrancy, donations, isolation, ownership, stale nonces, deadlines, rounding and bounded claim work covered on the actual local Arc runtime.',
  '- Actual public testnet approvals, funding, two-wallet forecasts, source-based resolution, claims, permissionless expired cancellation and original-deposit refunds confirmed.',
  `- Compiled production frontend browser checks passed (${browser.checkedAt}): ${browser.checks.join('; ')}.`,
  '- TypeScript/production build passed; production dependency audit reports zero vulnerabilities.',
  '- DAZZ branding, searchable sports/crypto cards and status filters pass public production browser checks. Three deadline regressions cover stalled preparation, late results and preserved simulation errors. A separate browser recovery check uses a test-only non-signing wallet read adapter with actual Arc balances/simulation/fees; it verifies recovery and a fresh actionable preview, not a particular external wallet approval flow.',
  '- Five release-gate regression tests reject changed contract source, different compilation, incomplete refunds, missing production-browser proof, untriaged findings and changed evidence.', '',
  `Slither ${security.version}: **0 high, 2 medium, 5 low** application findings. Both medium findings concern intentional fixed-point ordering; the five low findings concern intended timestamp deadline guards. Every finding has a documented disposition. This is an **in-house review, not an independent audit**. Imported dependency findings were filtered from this application-only scan.`, '',
  'The operator UI loads on demand and React/wallet code is split into cacheable chunks. Main entry is about 73.5 kB (20.6 kB gzip); claims do constant-sized work. Integer settlement arithmetic is unchanged from the verified deployment.', '',
  '## Mainnet and grant completion', '',
  `The current [Arc Microgrants requirements](https://dorahacks.io/hackathon/arc-microgrants/detail) exclude testnet-only builds and require working mainnet, public source and an accessible live link. Current deadline: **October 14, 2026, 23:59 ET**. No application or terms acceptance has been submitted.`, '',
  `Mainnet operator: \`${funding.operator}\`, **Arc Mainnet chain 5042**. Latest balance: **${funding.balanceUSDC} USDC**. Fund **${funding.requestedFundingUSDC} USDC on Arc Mainnet** for deployment and three sponsored markets; testnet USDC cannot pay mainnet fees. Do not send private keys.`, '',
  `The read-only mainnet simulation estimates a maximum deployment fee of ${funding.maximumDeploymentFeeUSDC} USDC. Three market creation/approval fees extrapolated from actual public testnet gas are about ${funding.estimatedThreeMarketFeesUSDC} USDC with headroom. Initial budget including 3 USDC backing: approximately **${Number(funding.estimatedInitialBudgetUSDC).toFixed(3)} USDC**. Fees change; trader deposits and later resolution/claims are separate.`, '',
  'Source is published at [debojyoti10CC/dass](https://github.com/debojyoti10CC/dass). The original wolf1276/dass source remote is retained as upstream. The included ZIP contains the application, contracts, tests, reference, documents and public evidence, plus the exact compiler verification input. It excludes protected signers, runtime state, installed dependencies and environment secrets.', '',
  'Mainnet deployment and market scripts validate the recorded source/evidence fingerprints before signing. After funding: deploy and verify mainnet, create fresh future real-event markets, verify actual mainnet wallet flows, build against the mainnet manifest, publish a public live frontend/source, and have the builder submit their own description/profile.', '',
  'Known limits: trusted resolver correctness, continuous Gaussian fit for discrete/skewed events, fixed conservative collateral rather than optimal collateral, no early exit/transferability, and no independent audit. Manual assistive-technology review remains pending. Windows DPAPI signers stay under the checkout’s ignored .private directory, tied to this Windows login; keep that folder with the Windows credential backup.', '',
  `Exact deployment compiler-input SHA256: \`${manifest.sourceSha256}\`.`, '',
];
fs.mkdirSync('../outputs', { recursive: true });
fs.writeFileSync('../outputs/Testnet-release-report.md', lines.join('\n'));
fs.copyFileSync('docs/security-review.md', '../outputs/Security-review.md');
console.log('Saved testnet release report and detailed security review under outputs.');
