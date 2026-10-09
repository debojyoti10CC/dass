# Delivery phases — Distribution Markets on Arc

Updated: 10 October 2026. All implementation phases are **not started**. Planning documents are complete; no contracts, app, network tests, or deployment have been completed.

Phases follow [plan.md](plan.md). Acceptance behavior comes from [PRD.md](PRD.md) and [Rules.md](Rules.md). Work proceeds sequentially across dependencies; independent tasks may be batched within a phase.

## Phase 1 — Prove the mechanism and numeric range

**Deliverables**

- High-precision reference model and immutable unit/normalization specification.
- Candidate fixed-point math library and exact numeric encodings.
- Admissible mean, standard-deviation, outcome, and backing/norm ranges.
- Solidity evaluator prototype, error analysis, and parity fixtures.
- Conservation examples including initial sponsor ownership and cancellation.

**Exit gate**

Demonstrate nonnegative payouts and exact integer collateral conservation across arbitrary claim order. Establish a bounded evaluator error, overflow-safe intermediates, safe tails, and backing-margin validation. Cover same-mean, shifted, wider/narrower, minimum-uncertainty, and extreme allowed cases.

**Stop condition:** unknown error bounds or unsafe intermediates. Reduce supported ranges and re-evaluate before financial storage logic. Do not substitute outcome buckets or an unverified minimum-loss solver.

## Phase 2 — Verify Arc integration

Depends on phase 1's token units and runtime assumptions.

**Deliverables**

- Pinned Arc Foundry/compiler configuration and documented local commands.
- Chain/token configuration checks and a small USDC transfer smoke test.
- Wallet setup and faucet instructions.
- Recorded local Arc-runtime and actual testnet observations.

**Exit gate**

Validate chain ID and decimals, exact allowance/deposit behavior, six/18-decimal handling, fee reservation, and transfer failure paths. Confirm transaction reconciliation behavior rather than assuming generic EVM receipts.

**Stop condition:** RPC/token mismatch, unsupported compiler/runtime behavior, or unclear transfer semantics. Resolve the mismatch before escrow deployment. No mainnet transactions belong to this phase.

## Phase 3 — Implement and verify core contracts

Depends on phases 1 and 2.

**Deliverables**

- One non-upgradeable market contract and pure Gaussian math module.
- Creation, preview/trade, timed close, resolve, expiry cancel, and individual claims.
- Complete events/getters and documented ABI.
- Unit, fuzz, conservation, access-control, and Arc-runtime lifecycle tests.

**Exit gate**

Validate nonce protection, exact deadlines, invalid/unchanged curves, duplicate finalization/claims, failed transfers, reentrancy, arbitrary claim order, and cross-market liability isolation. Show bounded single-claim work after many trades. No admin drain or mutable active-market rules.

**Stop condition:** any accounting discrepancy, unreachable rightful claim, or cross-market leakage. Fix the root cause before frontend trade wiring.

## Phase 4 — Build the usable forecasting flow

Depends on stable tested contract ABI. Follow [Design.md](Design.md).

**Deliverables**

- Market list/detail, forecast editor, positions, and operator pages.
- Read-only browsing, wallet/network onboarding, exact approvals, and simulation.
- Separate probability/P&L charts and clear fixed-collateral copy.
- Pending/unknown transaction persistence, stale-preview refresh, and claim/refund actions.
- Generated ABI/config exports, type checks, web build, and focused flow checks.

**Exit gate**

Two wallets can trade, inspect receipts, reload, and claim in the UI. Verify wrong network, wallet rejection, insufficient fees after approval, concurrent curve changes, receipt timeout, and unavailable metadata. Validate mobile, keyboard, screen-reader summaries, and reduced-motion behavior.

**Stop condition:** UI payoff differs from contract semantics, hidden collateral requirement, or retry that can create an unintended second receipt.

## Phase 5 — Release the testnet demo

Depends on phases 1–4 passing.

**Deliverables**

- Selected observation source, finalized rules/evidence format, and immutable market parameters.
- Verified contract deployment with manifest containing chain/address/block/compiler/source commit.
- Hosted frontend built against that exact manifest and ABI.
- README/runbook, faucet instructions, resolver trust disclosure, and evidence archive.
- Demonstrations of one resolved market and one expired/cancelled market.

**Exit gate**

Record transaction/explorer evidence for funding, two traders, final observation, claims, expiry cancellation, and refunds. Reconcile market and aggregate outstanding liabilities with all claimed funds. Check a fresh wallet and reload recovery. Verify contract source on the explorer.

**Stop condition:** missing verification, ambiguous observation rules, unresolved escrow discrepancy, or frontend pointing to a different contract.

## Phase 6 — Prepare a separate real-money release

Outside the testnet MVP; not authorized or implemented by these documents.

**Prerequisites**

Independent mathematical and contract security review; verified Arc-compatible scalar oracle strategy and dispute/failure policy; launch-jurisdiction assessment; operational controls and monitoring; deployment/recovery runbook; reviewed production configuration.

**Exit gate**

All findings affecting solvency and rightful claims are resolved, scalar-resolution integration is exercised, and production launch decisions are explicitly recorded. Testnet success alone does not meet this gate.

## Evidence and status ledger

| Phase | Status | Completion evidence |
| --- | --- | --- |
| 1 | Not started | None; only a floating-point illustrative accounting check during planning. |
| 2 | Not started | Documentation consulted; no RPC smoke transactions. |
| 3 | Not started | No contract source or test suite. |
| 4 | Not started | Design specification only. |
| 5 | Not started | No deployment, verified source, or hosted app. |
| 6 | Deferred | No reviews or production oracle integration. |

Update this ledger only with actual artifacts and results. A failed gate stays open; note the failure, owner, and next action in [Memory.md](Memory.md). Estimate implementation effort after phase 1; numerical verification is the primary uncertainty. Do not assign dates or declare a launch deadline without a project schedule.
