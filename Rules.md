# Implementation rules — DAZZ Markets on Arc

Status: normative implementation specification. Updated: 10 October 2026.

These rules define the app's behavior and implementation constraints. They do not replace user instructions or platform policies. Product scope is in [PRD.md](PRD.md); architecture is in [Architecture.md](Architecture.md).

## Mechanism invariants

| ID | Rule |
| --- | --- |
| R01 | Use continuous Gaussian outcome functions with immutable norm parameter `k` and backing `b` per market. Chart samples are display data, not settlement buckets. |
| R02 | Admit only positive standard deviations satisfying the backing bound and proven numeric limits, including the chosen safety margin. |
| R03 | Fix outcome units, normalization, precision, and rounding at creation. No active-market changes are permitted. |
| R04 | Every MVP trade deposits exactly `b`. A maximum-deposit argument can reject a trade, never change its stake. |
| R05 | Trader payout is deposit plus the difference between new and old integer curve evaluations at the finalized outcome. |
| R06 | Sponsor payout is `b + F(initial) - F(final)`. Initial curve ownership must not be omitted. |
| R07 | One deterministic `F` returns integer micro-USDC in `[0,b]` for all admitted curves/outcomes. Use the same evaluation/rounding for every occurrence. |
| R08 | Across all claims, payouts equal tracked deposits; no claim depends on claim order. Cancellation returns original deposits with zero market P&L. |
| R09 | No market may spend another market's liabilities. Donations create neither receipts nor extra backing. |
| R10 | Numeric approximation to the analytic curve must meet a documented error bound independently of integer accounting conservation. |

For the underlying formulas and example, see [plan.md, market math](plan.md). A clamp protects accounting; it is not a substitute for a correct Gaussian evaluator.

## Permissions and immutability

Only the configured operator creates markets; creator is sponsor. Only the market's immutable resolver reports its outcome. Only a receipt owner claims that receipt, and only its sponsor claims the sponsor entitlement. Anyone may cancel a market that has missed resolution.

Derive receipt ownership from the caller. Reject zero or invalid role addresses and invalid configurations. No active role replacement, rule rewriting, outcome correction, receipt transfer, emergency confiscation, or collateral-draining admin method exists in this release.

The resolver is trusted and must be labeled as such. Evidence commitments make submissions inspectable; they do not make an incorrect observation impossible.

## Time and state boundaries

Validate `creation time < closeAt < resolveBy`. Use onchain timestamps for enforcement and UTC timestamps in committed observation rules. Display local time with a visible timezone and access to UTC.

| Action | Required boundary |
| --- | --- |
| Trade | Active and `now < closeAt`; transaction deadline not passed. |
| Resolve | Active and `closeAt <= now < resolveBy`. |
| Cancel | Active and `now >= resolveBy`. |
| Claim | Terminal status and unclaimed ownership. |

Resolved and cancelled states never transition again. At the resolution deadline, cancellation is eligible and resolution is ineligible. Trading stops by timestamp without a keeper.

## Transaction and custody rules

- Validate contract-side parameters even when the UI already checked them.
- Require the expected market nonce. Reject unchanged curves and expired quotes. Increment nonce once per successful trade.
- Use ERC-20 USDC for deposits/payouts. Use six decimals for these amounts and 18 decimals for native gas estimates. Never mix raw units.
- Use exact required approvals; do not default to unlimited allowance.
- Keep enough shared USDC balance for fees as well as collateral; estimate again after approval.
- Use safe token calls, checks/effects/interactions, and reentrancy protection. Failed transfers revert flags and accounting.
- No loops over all receipts during settlement or claiming. Claiming one receipt must perform bounded work.
- No private keys, secrets, or privileged server signatures in browser bundles or tracked files.
- Never infer success from a submitted hash alone or failure from a receipt timeout. Reconcile unknown state before suggesting retry.

## Numerical rules

Use signed fixed-point coordinates, a reviewed math dependency, and documented conversion helpers. The implementation pins PRBMath 4.1.0 and compiles for the Arc-compatible Paris EVM target. Do not implement new exponential/square-root primitives for this app.

The local implementation establishes admissible ranges, overflow safety, error budgets, tail behavior, and high-precision parity fixtures in [reference/numeric-spec.md](reference/numeric-spec.md). Its measured maximum error is below one micro-USDC per curve evaluation. This bound is for the admitted input domain; retain parity and boundary checks when changing the evaluator.

No minimum-collateral optimization ships without a reviewed global loss bound. A chart grid, local extremum, or backend quote cannot authorize undercollateralized trades.

## UX rules

Show fixed collateral, settlement timing, resolver trust, and gas separately. Label forecast density, range probability, P&L, and payout correctly. Do not equate deposit with price, maximum loss estimate with guaranteed realized loss, or uncertainty with position size.

A stale market requires a fresh preview and another trade action. Never silently submit a materially changed payoff. Provide numeric controls, keyboard operation, visible focus, readable labels, and text alternatives to color. Keep a chart-independent claim path.

Show committed rules only after their hash matches. Metadata failure must not disable contract-based claims or refunds. Unknown transaction state must not become a generic retry button.

## Verification and change discipline

Test meaningful invariants, permission/time boundaries, numeric edge cases, transfer failure, and end-to-end lifecycle behavior. Use Arc-runtime tests and actual testnet USDC; standard mocks alone are insufficient.

For a behavioral change, inspect affected contract callers, ABI exports, frontend previews, reference fixtures, tests, deployment configuration, and these documents. Prefer the smallest complete implementation, existing helpers, and established libraries. Do not add deferred scope speculatively.

A known implementation shortcut gets a one-line code comment: `shortcut: <limit>, <when to upgrade>`. The fixed-deposit mechanism must also remain disclosed in the UI and docs.

Keep facts, assumptions, proposals, and test results separate in [Memory.md](Memory.md). Record evidence for completed gates in [Phases.md](Phases.md). Do not mark implementation complete based on documentation alone.
