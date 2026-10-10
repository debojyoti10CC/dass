# Build phases and verified evidence

Updated: 10 October 2026. Local implementation follows [plan.md](plan.md), [PRD.md](PRD.md) and [Rules.md](Rules.md). Status records refer to this checkout and to the exact environment stated below.

## Phase 1 — mechanism and numerical range: passed

Reference model uses Python Decimal at 90 digits; evaluator uses signed/unsigned WAD and pinned PRBMath 4.1.0. Bounds, overflow, safety margin, Gaussian tail and error analysis live in [reference/numeric-spec.md](reference/numeric-spec.md). Its `--check` result was **189 fixtures, 16,380 analytic comparisons, 600 claim-order reconciliations and 12 invalid inputs**; maximum measured absolute error was 0.49999999999992445 micro-USDC against a conservative 0.500003 bound. The same 189 integer outputs matched the compiled Solidity evaluator on the local Arc runtime.

This is a documented bound over admitted parameters, not a formal verification or security audit. The claim differences telescope exactly in integer accounting independently of analytic approximation error.

## Phase 2 — Arc integration: local runtime and public funded lifecycle passed

Verified official testnet configuration by a read-only request: chain 5042002, USDC ERC-20 decimals 6, native decimals 18 with the shared-balance conversion, RPC/client identity, and observed gas data are captured in [deployments/arc-testnet-readonly-evidence.json](deployments/arc-testnet-readonly-evidence.json). Arc Foundry `v0.8.0-2` and Solidity `0.8.30` checksums were verified and tools install under ignored `work/`. Actual approval/transfer and event streams passed on Arc's local runtime in [deployments/arc-local-smoke-evidence.json](deployments/arc-local-smoke-evidence.json).

Public deployment, exact approvals, actual funding transfers, forecast deposits and paid claims are confirmed. Native-token restriction and recovery behavior is exercised on the actual local Arc runtime; the project cannot administratively restrict a public user’s token balance for testing.

## Phase 3 — core contracts: local Arc runtime passed; independent review pending

`DistributionMarkets.sol` enforces operator-only creation, fixed backing deposits, immutable rules and resolver configuration, nonce-protected curve changes, exact close/resolve/expiry boundaries, normalized scalar outcomes, per-receipt and sponsor claims, escrow isolation, safe token transfers and reentrancy protection. `GaussianMath.sol` is pure and tested independently.

`npm run test:contracts` passed **16 tests** on Arc localhost, including all Solidity fixtures, roles, normalization edge cases, transfer failures, reentrancy, 50-trade bounded claim gas, two wallets, resolved sponsor/trader claims, cancellation refunds, and actual native Arc USDC lifecycle. Gas to claim comparable receipts after 50 trades was 128,249 and 111,149 units; claim logic has no history-sized loop. `npm run test:forge` passed **10 Arc Foundry tests** with three fuzz properties at 256 runs each. Five tests use Arc's real USDC predeploy, including restricted-transfer failure and later rightful claim recovery. Raw details and source hashes live in [deployments/arc-runtime-test-evidence.json](deployments/arc-runtime-test-evidence.json) and [deployments/arc-runtime-tests.txt](deployments/arc-runtime-tests.txt).

Local test coverage does not replace an independent code/math/security review. Record no independent audit.

## Phase 4 — user flow: local browser acceptance passed; assistive-technology review pending

React, TypeScript and viem application implements market discovery/detail, verified rules, paired forecast and P&L charts, keyboard scenario inspection, fixed-collateral review, positions, sponsor claims, operator setup/resolution/cancellation, wallet/network checks, exact USDC approvals, call simulation, stale preview refresh, pending/unknown transaction hash persistence, and chain-authoritative recovery.

The browser acceptance at `npm run test:browser` used two disposable trader accounts to change the same market, verified each account selection and exact approval, confirmed both trades, and recovered positions after a page reload. The 390px viewport had no horizontal overflow, keyboard Tab focused the skip link, and no uncaught browser errors occurred. The browser script leaves its screenshot at ignored `work/browser-demo.png`. TypeScript and production builds pass. A manual screen-reader/assistive-technology review remains open; this local browser check does not demonstrate public deployment or a full production accessibility audit.

## Phase 5 — public Arc Testnet: deployed and source-verified

`deployments/arc-testnet.json` records the actual deployment at `0xc613bca497257cfec8d1754e1d81136cb9862ca8`, its successful transaction/block, operator and explorer verification. Three genuine event markets are sponsored with native USDC. Two separately generated, funded public wallets have confirmed forecast receipts; stale-nonce rejection and public browser acceptance pass. The exact Coinbase candle closed at 82,583.69 USD; trader/sponsor claims paid 3 USDC from 3 USDC deposited. A fourth explicit recovery exercise expired and refunded 2 USDC after cancellation by a non-resolver. Balance and total liability both equal 2 USDC for football backing. Slither reports zero high, two reviewed medium and five reviewed low findings; no independent audit is claimed. A live local frontend now reads this public deployment. See [docs/public-release.md](docs/public-release.md).

The optional `npm run demo` remains a separate synthetic localhost fixture for development. The default application uses actual public testnet markets and injected wallets.

## Phase 6 — mainnet: testnet prerequisites complete; funding and publication pending

The user requests mainnet after full testnet testing and security checks for Arc Microgrants, which excludes testnet-only builds. Do not imply that automated scans or an in-house review are an independent audit. Record completed testnet gates before mainnet, estimate real fees, supply actual Arc mainnet USDC, deploy/verify the principal application contract, create new future real-event markets, and publish a working frontend/public source. Public source is published at https://github.com/debojyoti10CC/dass; the private review hosting still needs an accessible public mainnet release. Mainnet is not deployed and no program application has been submitted.

## Commands to reproduce local gates

```powershell
npm ci
npm run tools:arc
npm run node:arc
npm test
npm run check
npm run build
npm audit --omit=dev
npm run demo
npm run test:browser
```

Run the local Arc node before `npm test`. `npm run demo` starts the local chain, seeds two synthetic fixture markets, and opens the local-only app. With the demo running, `npm run test:browser` exercises the browser flow. Keep public testnet transactions and signers separate from localhost test accounts.

## DAZZ interface and forecast preparation recovery

DAZZ Markets adds searchable category/status-filtered cards, onchain summary metrics, responsive branding, a favicon and a clearer detail hierarchy. Public production browser checks cover actual market records, rules, source/transaction links, search/filter empty-state recovery and mobile discovery/detail without overflow. Review timeout regressions cover unresponsive reads, rejection preservation, late-result rejection and a fresh successful simulation afterward. The browser recovery uses a test-only wallet read adapter that cannot sign/broadcast, with actual Arc RPC balances/simulation/fees; it is separate from real wallet transaction evidence. See deployments/arc-testnet-review-evidence.json.

The public-testnet funding panel passes production browser checks for exact connected-address copying, actual public Arc balance refresh, account/disconnect invalidation, keyboard dialog dismissal/focus restoration, and mobile layout. It opens Circle's official faucet; requests and CAPTCHA remain on Circle's site. No faucet request or wallet transaction is sent by this UI test. See deployments/arc-testnet-funding-evidence.json.
