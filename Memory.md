# Project memory — DAZZ Markets on Arc

Updated: 10 October 2026. Records describe actual observations and receipts. Read Phases.md and docs/security-review.md for current gates and limitations.

## User intent and scope

Clone wolf1276/dass separately, follow PRD/Architecture/Rules/Phases/Memory and the Paradigm Distribution Markets paper, build autonomously with the requested Coinbase Design.md, and run locally beside the browser. Later instructions require real wallets, real transactions and real-world markets, public testnet deployment/testing/security review before mainnet, and eventual mainnet for Arc Microgrants. Mainnet has not been deployed; the operator has no mainnet funds. No grant submission has been sent.

## Mechanism and application

- Fixed-norm continuous Gaussian payout with conservative fixed backing b per sponsor/trader. The paper's optional optimal collateral is not implemented. Deterministic micro-USDC evaluations make receipt/sponsor differences telescope exactly.
- WAD coordinates, sigma, norm and normalization; six-decimal ERC-20 USDC collateral and eighteen-decimal native gas share one balance. Outcomes round once to the nearest immutable step, exact halves away from zero. Bounds are step-aligned.
- Immutable token/operator; immutable per-market resolver/rules/deadlines; nonce/deadline/deposit protection; constant-work individual claims; permissionless expired refunds; no admin drain or upgrade. Resolver correctness is trusted and disclosed.
- Default localhost frontend at http://127.0.0.1:5173 reads the actual public Arc Testnet deployment and connects injected wallets. A separate optional local demo uses synthetic fixtures and disposable accounts. Public transaction storage includes RPC and contract identity because local Arc shares the testnet chain ID.
- Coinbase layout/tokens are implemented from the requested imported design. Exact WAD editing avoids floating-point input drift; approximate calculations are confined to charts. Operator UI is lazy-loaded. Confirmed public forecast events appear with actual wallet/transaction links.

## Actual public testnet

- Chain 5042002, https://rpc.testnet.arc.io. Contract **0xc613bca497257cfec8d1754e1d81136cb9862ca8**, deployment tx **0x24543eb7f6d6a605693227bd4c3e31e44b9c2550ca83d07a329f59f08e50c5bc**, block 66385566. Explorer source verification passed.
- Dedicated operator/resolver **0x8c22625D7f7fd74590F0c57956C2A229E3D2AcBC** and two separately generated/funded trader wallets. Local development keys were never used publicly. Signers are protected with Windows CurrentUser DPAPI in Git-ignored `.private/`, excluded from browser/source archives. Back up that encrypted folder with this Windows account's credential backup.
- Three real-event markets: exact Coinbase BTC/USD candle; Coventry City–Newcastle United total goals (Oct 12, 19:00 UTC); Everton–Chelsea total goals (Oct 17, 11:30 UTC). Official fixture schedule/source committed in self-contained hashed rules. Initial curves are sponsor forecasts, not bookmaker odds.
- BTC candle epoch 1791589920 closed at **82,583.69 USD**. Original source bytes, canonical evidence and hash are archived under web/public/evidence. Both actual traders and sponsor claimed: 1.021074 + 0.960277 + 1.018649 = **3 USDC deposited and paid**. Stale nonce was rejected.
- Fourth market was explicitly an expiry recovery exercise on a genuine future BTC candle, with the resolver intentionally offline. A non-resolver wallet cancelled after the real deadline; trader/sponsor each received 1 USDC back. **2 USDC deposited and refunded**. Contract balance equals total liability: 2 USDC for the two football sponsors.
- Evidence: deployments/arc-testnet-{deployment,verification,acceptance,resolution,expiry,browser,test,security}-evidence.json. Only DistributionMarkets requires deployment; internal math/dependencies are inlined, test harnesses/mocks are excluded.

## Verification

- 90-digit numeric reference: 189 fixtures, 16,380 analytic comparisons, 600 claim orders, 12 invalid cases. Maximum observed error 0.49999999999992445 micro-USDC, conservative bound 0.500003.
- Fresh full npm test: 16 Node lifecycle/adversarial tests, 10 Arc Forge tests and 768 fuzz runs. Actual Arc native-USDC restriction rollback, claim recovery, balance/event precision, market isolation, reentrancy and donations exercised on local Arc runtime.
- TypeScript/production build and actual public RPC browser checks pass. Mobile 390px has no horizontal overflow; no uncaught browser errors; no fake injected wallet or browser signing material. Manual assistive-technology review remains pending.
- Slither 0.11.6: zero high, two medium fixed-point ordering findings and five low timestamp guards; all manually reviewed with dispositions. **No independent audit** has been performed. Production dependency audit: zero vulnerabilities.

## Remaining mainnet and publication

Mainnet chain 5042 is verified read-only and configured separately in deployments/arc-mainnet.json. Release evidence is tied to current source/evidence fingerprints by scripts/release-gate.mjs. Actual mainnet USDC must fund deployment fees and sponsor backing before any mainnet broadcast. Then deploy/verify, create fresh future markets, check actual mainnet wallet flows, and publish a public live link/source.

The source was pushed through terminal Git to https://github.com/debojyoti10CC/dass on main at e397b3b. The original wolf1276/dass remote is retained as upstream. No PR has been created. The current program page excludes testnet-only builds and requires a working mainnet app/public repository/accessible link by October 14, 2026, 23:59 ET. The builder submits their own description/profile; no application or terms acceptance is authorized here.

## DAZZ Markets interface update

The user named the product **DAZZ Markets** and requested component improvements. The application now uses its own D/curve wordmark and favicon, searchable cards, sports/crypto filters, settlement-status filtering, and market/escrow counts derived from contract records. Card curves display the confirmed Gaussian forecast; the hero diagram is explicitly an illustration. Market detail leads with forecast controls and places confirmed activity afterward. Contract ABI, signing, escrow arithmetic, market rules and protected keys remain the deployed implementation.

A reported stall at Preparing review was reproduced as an indefinitely pending wallet read; public RPC also returned explicit -32005 rate limits. Event history is scanned incrementally with shared in-flight reads, RPC calls are paced with bounded throttling retries, and hidden pages skip polling. Empty transaction history no longer starts a duplicate refresh. Read-only review preparation has a 35-second deadline and visible stages/errors; signing and submitted-transaction recovery are not timed out by this guard. Three deadline regressions and a production-browser timeout/recovery check passed. The latter uses a test-only non-signing wallet read adapter for an actual funded testnet address; balances, rules, simulation and fees come from public Arc RPC. It does not prove a particular user wallet’s approval/signing flow.

Discovery now reads the existing immutable contract marketCount and contiguous IDs directly, avoiding a full MarketCreated history scan. Public testnet reads fall back to the Blockdaemon endpoint listed in Circle’s official arc-node guide, with chain ID/runtime bytecode/event-history parity recorded in deployments/arc-testnet-rpc-evidence.json. The review regression forces primary -32005 throttling and verifies that the real secondary endpoint still produces an actionable preview.
