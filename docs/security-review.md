# Contract and application security review

This is an in-house code review with numerical, adversarial, runtime and public-chain evidence. It is **not an independent audit** or a guarantee of safety. The public testnet contract is `0xc613bca497257cfec8d1754e1d81136cb9862ca8`; its source is explorer-verified. Mainnet has not been deployed.

## Scope and invariants

- `DistributionMarkets.sol` and its inlined `GaussianMath.sol`, compiled with Solidity 0.8.30, optimizer 200, viaIR, Paris. Deployment source SHA256 is in the public manifest and receipt evidence.
- Every sponsor and trader deposits the same immutable backing for that market. The deterministic integer evaluator is reused for every payout, including the sponsor. Differences telescope exactly; no floating-point settlement is used.
- Mean, sigma, norm, backing and canonical outcomes are bounded. The peak check leaves one micro-USDC of headroom. The normalization products remain below `2e56`; exponential input remains in `(-32,0]`; tail checking precedes squaring.
- Claims apply ownership checks, terminal-state checks, checks/effects/interactions and the reentrancy guard. A failed or restricted transfer reverts claim flags and liabilities. Market escrow cannot be spent by the operator or resolver. There is no drain, upgrade, sweeping or arbitrary withdrawal function.
- The token and operator are immutable. Only the operator creates and sponsors markets. Each market freezes its resolver, rules commitment, units, normalization, bounds, close and expiry. The resolver can report an incorrect admissible outcome: this is a disclosed trust assumption, not an oracle verification guarantee.
- Trading requires an active market before its close, the exact market nonce, a user deadline and a maximum deposit. Expired cancellation is permissionless and returns original deposits. Claims have constant-size work and never iterate through all traders.

## Executed checks

- 189 Solidity/Python parity fixtures, 16,380 analytic numerical comparisons, 600 claim-order checks and 12 invalid configurations. Maximum observed rounding error: 0.49999999999992445 micro-USDC; the specified conservative limit is 0.500003.
- 16 lifecycle/adversarial Node tests pass. Tests include reentrant token callbacks, precision and bounds, ownership, stale quotes, deadlines, token restrictions, direct donations, market isolation, resolution and expiry refunds.
- 10 Arc Forge tests pass, including three fuzz tests with 256 runs each. Native Arc USDC restriction/blocklist, shared balance conversion and claim recovery are exercised on the actual Arc runtime.
- Public Arc Testnet: actual deployed bytecode, immutable getters, source verification, three sponsored real-event markets, exact native-USDC approvals, two separately generated and funded trader wallets, confirmed forecast receipts and stale-nonce rejection. The exact Coinbase candle closed at **82,583.69 USD**; both trader claims and the sponsor claim paid **3 USDC from 3 USDC deposited**. A fourth, explicitly labelled recovery exercise expired without a resolver report: a non-resolver cancelled and both original deposits were refunded, **2 USDC from 2 USDC deposited**. Remaining native-USDC contract balance and total liability both equal 2 USDC for the football markets.
- TypeScript and production build pass. Production dependency audit reports zero vulnerabilities. Public browser checks pass for real market discovery, embedded rules integrity, source links, wallet connection requirement, mobile layout and zero page errors.

## Findings addressed before mainnet

1. **Deployment history isolation.** Local Arc and public testnet share chain ID 5042002. Transaction storage now includes RPC and contract identity, and each record must contain the matching deployment context. This prevents a local receipt being presented with a public-chain explorer link.
2. **Exact forecast editing.** Forecast inputs use exact `formatUnits` conversion from WAD. Floating-point conversion could otherwise introduce an invisible curve change and charge collateral for it. Approximation remains confined to explicitly labelled chart previews.
3. **Signing material and ambiguous submissions.** Separately generated operator/trader keys are protected by Windows CurrentUser DPAPI in Git-ignored `.private/`, and never served to the frontend. Scripts persist the deterministic signed transaction hash before broadcasting and reconcile it on restart. They never create a replacement deployment after an ambiguous RPC response.
4. **Rules availability.** Real markets store bounded self-contained canonical base64 JSON in `rulesURI`; the browser checks the exact bytes against the onchain commitment. Official source links, missing-data policy, rounding and rescheduling rules are visible before trading.
5. **Release and action reconciliation.** Mainnet requires completed resolution/refund/browser/test/security evidence, matching source fingerprints and matching evidence digests. Saved public actions are checked against signer, chain, contract and calldata before their receipt can be reused. A dry deployment estimate does not change the frontend's selected manifest.

## Static analysis and manual triage

Slither **0.11.6** successfully analysed the application with Solidity 0.8.30. The application scope produced **0 high, 2 medium and 5 low** findings, all reviewed. Imported dependency findings are filtered; this count is not a dependency audit. Exact source fingerprints and findings are in `deployments/arc-testnet-security-evidence.json`.

- Medium `divide-before-multiply` in GaussianMath: deliberate WAD quantization of the distance/sigma ratio before squaring. Numerical bounds and the high-precision comparison suite cover this admitted representation. Changing order would change the verified settlement evaluator.
- Medium `divide-before-multiply` in normalization: intentional quotient-to-grid multiplication after remainder-based nearest-step rounding. Positive/negative exact-half cases and aligned endpoints are covered by tests.
- Five low `timestamp` findings: intended trading/creation/resolution/expiry guards. Timestamp supplies deadlines, never randomness. Consensus time and the trusted resolver remain assumptions.

No findings remain untriaged. Automated scans and the review above do not establish an independent audit or eliminate undiscovered bugs.

## Costs and optimizations

Public testnet deployment used 2,657,913 gas, costing 0.08305978125 test USDC at the submitted price. The two forecast changes used 306,011 and 271,823 gas. Rules are intentionally self-contained: market creation costs roughly 2.2–2.5 million gas, rather than relying on an operator-hosted metadata server. Individual claims avoid unbounded loops.

The operator UI loads only when opened. React and wallet code use cacheable chunks; the application entry is about 63 kB before gzip instead of a single roughly 576 kB bundle. Settlement arithmetic was kept unchanged after successful numerical verification.

## Remaining release evidence

Public resolution and refund records are complete. Mainnet needs actual Arc mainnet USDC, a confirmed deployment with source verification, and mainnet wallet acceptance. Public hosting/source and a manual assistive-technology review remain open. The GitHub account currently has read-only access to `wolf1276/dass`, so publication to that repository needs write access. No independent audit has been performed.
