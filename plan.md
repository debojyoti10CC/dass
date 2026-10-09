# Distribution Markets on Arc — implementation plan

Prepared: 10 October 2026. Status: proposed build plan; no application or contracts have been implemented or deployed.

Supporting specifications: [PRD.md](PRD.md), [Architecture.md](Architecture.md), [Rules.md](Rules.md), [Phases.md](Phases.md), [Design.md](Design.md), and [Memory.md](Memory.md).

## 1. Goal and assumptions

Build a USDC-settled prediction dapp where a trader changes the market's forecast for a numeric outcome by adjusting its mean and uncertainty, sees their profit/loss curve, deposits collateral, and claims after resolution.

Assume **Arc means Circle's Arc blockchain**. Start on **Arc Testnet**. This is a new project: the workspace currently has no application code or existing dependencies to preserve.

The reference is Dave White's [Distribution Markets](https://www.paradigm.xyz/writing/distribution-markets), published 10 December 2024. Its central mechanism uses continuous outcome functions with a fixed L2 norm. A trade receives the difference between the new and previous functions; backing and trader collateral must cover every possible outcome. Gaussian distributions offer a compact representation. This plan implements that family and deliberately starts with more collateral than the minimum.

The scope, contract interfaces, oracle policy, collateral shortcut, UI, and milestones below are proposed implementation choices, not a claim that the article supplies production-ready code.

## 2. Smallest useful MVP

Launch with one operator-created, short-lived demo market whose outcome is a numeric observation from a named public source. Use a metric naturally compatible with a Gaussian approximation, such as a reported temperature at a specified station and timestamp. Fix the source, observation field, units, timestamp, rounding, and missing-data rules before funding.

Users can:

1. Connect an EVM wallet, switch to Arc Testnet, and obtain faucet USDC.
2. Inspect the current forecast, its uncertainty, market rules, closing time, and resolver.
3. Choose a new mean and standard deviation within the market's permitted parameter bounds.
4. Preview the old/new curves, collateral, outcome-dependent P&L, and gas estimate.
5. Approve the exact USDC deposit, submit the curve change, and receive a position receipt.
6. View their receipts and claim each payout after resolution, or get their deposits back after cancellation.

Each trade replaces the entire market curve. There is no arbitrary stake-size control in this version: every receipt uses a fixed deposit equal to the market's backing. Explain this prominently so the UI does not imply that a slider changes position size.

**Defer:** additional distribution families, capped Gaussians, optimal collateral computation, permissionless market creation, dynamic LP deposits/withdrawals, early position closing, transferable position tokens, protocol fees, bridges, sponsored gas, embedded wallets, governance, and a dedicated backend/indexer.

## 3. Arc integration

Current official documentation redirects from `docs.arc.network` to `docs.arc.io`. Use the current documented endpoints rather than hard-coding older tutorial URLs.

| Setting | MVP value |
| --- | --- |
| Network | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| Faucet | [Circle Faucet](https://faucet.circle.com) |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` |
| Application transfers | ERC-20 interface, 6 decimals |
| Native gas accounting | USDC, 18 decimals |

These values come from [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc), [Contract addresses](https://docs.arc.io/arc/references/contract-addresses), and [Gas and fees](https://docs.arc.io/arc/references/gas-and-fees). The two USDC interfaces share a balance; users need enough for their deposit **and** transaction fees. Query fee estimates and reserve gas funds in the UI.

Use ERC-20 `approve`, `transferFrom`, and `transfer` for all collateral and payouts. Do not mix `msg.value` with 6-decimal token amounts. Reject payable entry points. Verify chain ID and USDC `decimals()` during setup; stop if they disagree with configuration.

Follow the [Arc deployment workflow](https://docs.arc.io/arc/tutorials/deploy-on-arc): Arc Foundry (`arc-forge`, `arc-cast`, `arc-anvil`), tests with `--network arc`, and explorer verification. Review [EVM differences](https://docs.arc.io/arc/references/evm-differences.md) before implementation. Pin compatible compiler/tool versions after the initial smoke test.

## 4. Market math and accounting

### 4.1 Continuous Gaussian state

For real-valued outcome `x`, use:

```text
p(x; μ, σ) = exp(-(x-μ)² / (2σ²)) / (σ sqrt(2π))
λ(σ)       = k sqrt(2σ sqrt(π))
f(x; μ, σ) = λ(σ) p(x; μ, σ)
h(x)       = b - f(x; μ, σ)
```

Here `b` is the sponsor's backing in USDC and `k` is the fixed norm parameter. Require `σ > 0` and:

```text
peak(f) = k / sqrt(σ sqrt(π)) ≤ b
σ ≥ k² / (b² sqrt(π))
```

The stored market state is `μ`, `σ`, `k`, and `b`, not an array of outcome buckets. The chart samples the curve for display only. Parameter limits bound computation; they do not truncate the outcome domain or turn the market into discrete YES/NO bets.

Fix the coordinate system at market creation, e.g. `x = (reportedValue - origin) / scale`, with positive scale. Store it in the immutable rules. Changing units changes the norm's interpretation, so neither the frontend nor resolver may silently re-scale an active market.

### 4.2 Conservative trader collateral

For a change from `f_old` to `f_new`:

```text
position P&L(x) = f_new(x) - f_old(x)
minimum deposit = max(0, sup_x(f_old(x) - f_new(x)))
MVP deposit D   = b
receipt payout  = D + f_new(x*) - f_old(x*)
```

Since each admissible curve lies between `0` and `b`, the payout lies between `0` and `2b`. Depositing `b` is a simple sufficient bound. It avoids accepting a browser-supplied maximum-loss estimate as proof of solvency. It locks more capital than necessary; unused collateral is returned as part of settlement.

For a later efficient-collateral version, implement and independently review a global maximum-loss bound for Gaussian differences, with certified numerical error and adversarial tests. A sampled chart, a stationary point alone, or an unsigned server quote is insufficient.

### 4.3 Sponsor ownership and conservation

The sponsor deposits `b` and retains the economic interest in the initial curve `f₀`. Record this explicitly; otherwise initializing a nonzero curve creates an unexplained claim.

After `n` trades with deposits `Dᵢ`, and final curve `fₙ`:

```text
vault deposits              = b + Σ Dᵢ
trader i payout             = Dᵢ + fᵢ(x*) - fᵢ₋₁(x*)
sponsor payout              = b + f₀(x*) - fₙ(x*)
sum of all payouts          = b + Σ Dᵢ
```

The terms telescope, and every payout is nonnegative. The sponsor owns both the initial curve and the residual AMM position. There is one sponsor per market, with no liquidity-share token or live liquidity changes.

Implement payouts with one deterministic integer curve evaluator `F`, in 6-decimal USDC units, constrained to `[0, b]`. Use the exact same evaluator for every occurrence of a stored curve, including sponsor settlement. Then conservation holds for the actual integer payouts without independently rounding each difference. Track liabilities per market; unsolicited token transfers do not create claims or increase `b`.

**Sanity fixture:** choose `b = 10 USDC`, initial `σ = 1`, and `k = b sqrt(sqrt(π))`, so the initial peak is `10`. A trade at the same mean with `σ = 4` has peak `5` and deposits `10`. If resolution is at that mean, the trader receives `5` and the sponsor receives `15`: total `20`, exactly the escrowed deposits. Fixed-point tests must establish the actual integer values/tolerances.

### 4.4 Numerical implementation gate

Use signed fixed-point values for coordinates and unsigned integer collateral. Select one reviewed fixed-point math library with exponential and square-root operations after checking compatibility; do not write a custom transcendental library.

Before writing trading storage:

- Produce a high-precision reference model and Solidity cross-check fixtures.
- Bound mean, standard deviation, normalized outcomes, and intermediate magnitudes against overflow.
- Prove an absolute evaluator-error budget over the admitted parameters. Choose it so error at each curve endpoint is at most one micro-USDC, or reduce market bounds until this holds.
- Handle far tails using a documented cutoff with a bounded omitted payout; avoid squaring an unbounded input.
- Enforce the backing constraint with a numerical safety margin. Reject parameter sets outside the proven range.
- Clamp the final integer evaluator to `[0, b]` as an accounting safeguard, and test that ordinary allowed inputs do not materially rely on that clamp.

`F` gives exact escrow conservation, while its approximation to the analytic curve is separately measured. If numerical accuracy cannot be established, reduce the parameter range before proceeding. Do not replace the continuous mechanism with buckets without changing this plan.

## 5. Contracts and lifecycle

Use one non-upgradeable `DistributionMarkets` contract with market mappings, receipt mappings, access controls, and reentrancy protection. Separate pure Gaussian math into a small library for testing. Avoid a factory and proxy system for the first deployment.

### Stored records

**Market:** sponsor, immutable resolver, rules hash/URI, units and normalization, `b`, `k`, initial/current curves, parameter bounds, trading close, resolution deadline, status, state nonce, finalized outcome, market deposit/paid counters, and sponsor-claimed flag.

**Receipt:** owner, market ID, old/new curve parameters, deposit, and claimed flag. IDs are monotonic; receipts are nontransferable contract records. Ownership is derived from `msg.sender`.

### Minimal entry points

| Function | Behavior |
| --- | --- |
| `createMarket(config, initialCurve)` | Operator only; creator is sponsor; validate rules and numeric bounds, pull creator backing, and emit creation event. |
| `previewTrade(marketId, newCurve)` | Return old/new state, fixed deposit, and state nonce; chart evaluation is offchain. |
| `trade(marketId, newCurve, expectedNonce, maxDeposit, deadline)` | Validate active status, close time, bounds and nonce; pull deposit; save receipt; replace curve; increment nonce. |
| `resolve(marketId, outcome, evidenceHash)` | Immutable resolver only, at/after close and before deadline; validate canonical normalized outcome; finalize once. |
| `cancelExpired(marketId)` | Anyone may cancel an unresolved market at/after the resolution deadline. |
| `claim(receiptId)` | Owner only; pay resolved amount or cancelled deposit; prevent double claim. |
| `claimSponsor(marketId)` | Sponsor only; pay resolved sponsor amount or cancelled original backing. |

A frozen market stops trading automatically at `closeAt`; no keeper transaction is necessary. Terminal states are `Resolved` or `Cancelled`, with no transitions between them. Use an exclusive deadline convention: resolution requires `now < resolveBy`, cancellation requires `now >= resolveBy`.

Cancel only for missed resolution, not because a resolver dislikes the outcome. Cancellation refunds each trader's actual deposit and sponsor backing, with zero market P&L. No admin can rewrite rules, seize collateral, change an active curve, or drain outstanding liabilities.

Emit `MarketCreated`, `CurveChanged`, `MarketResolved`, `MarketCancelled`, `PositionClaimed`, and `SponsorClaimed` with identifiers sufficient for wallet history. Set claim flags and accounting before external calls; if a transfer fails, the whole claim must revert. There is no payout loop over all traders. One receipt claim remains constant work regardless of trade count.

## 6. Resolution policy

Use a clearly disclosed **trusted operator resolver for the testnet demo**. A single numeric outcome, evidence hash, and immutable rules determine payouts. Do not describe this arrangement as decentralized or trustless.

For each market specify:

- Named source, exact observation field, UTC observation time, unit and normalization.
- Whether the first publication or a later revision is authoritative.
- Exact precision, rounding, and acceptable outcome encoding.
- Resolution deadline and missing-data behavior: unavailable or inadmissible data leads to expiry cancellation.
- Resolver address and evidence format; retain the raw observation in a durable content-addressed document.

A production oracle must deliver a scalar numeric value and support these rules. Verify actual Arc deployment and availability before selecting a vendor; no oracle address or support is assumed here. Automated feeds and dispute resolution require a separate integration and review before real-money launch.

## 7. Frontend and data

Use React + TypeScript + Vite, viem/wagmi for EVM interactions, and a lightweight SVG curve chart. No backend is necessary for the initial market count. Pin dependency versions when scaffolding; generate ABI/address exports from the actual deployment.

Screens:

- **Markets:** question, current mean/uncertainty, closing time, and status.
- **Market detail:** rules, resolver, forecast probability curve, old/proposed payout curves, numeric mean/uncertainty inputs, backing-derived minimum uncertainty, and trade form.
- **My positions:** receipt P&L curves, deposited USDC, pending/resolved status, payout or refund, and claim action.
- **Operator:** create a market and submit its final observation/evidence.

Distinguish probability density, probability within a selected range, deposited collateral, settlement payout, and P&L. Probability density at a point is not the probability of that exact outcome. Describe mean as the expected outcome and standard deviation as uncertainty. Provide keyboard-operable inputs, numeric alternatives to sliders, axis labels/units, and non-color-only P&L indicators.

Before submission: verify chain, gas headroom, allowance, nonce and deadline; simulate the call. Show approval and trade as separate transactions. If the nonce changed, refresh the old curve and require a new preview. Do not silently accept a changed payoff profile.

Read records from the contract; use paginated RPC logs from the deployment block for discovery/history, deduplicated by transaction hash and log index. Index the dapp's own events instead of inferring positions from USDC transfer logs. Cache only as a convenience; chain state is authoritative.

Display pending, confirmed, rejected, reverted, and unknown transaction states separately. A receipt timeout is not proof of failure. Allow reconciliation using transaction hash and contract state before inviting a retry.

## 8. Planned repository layout

```text
contracts/
  src/DistributionMarkets.sol
  src/GaussianMath.sol
  test/GaussianMath.t.sol
  test/DistributionMarkets.t.sol
  script/Deploy.s.sol
web/
  src/chain.ts
  src/contracts.ts              # generated ABI and deployment configuration
  src/math.ts                   # chart/reference preview only
  src/pages/                    # market, positions, operator
reference/
  model.py                      # high-precision oracle and fixtures
  fixtures.json
deployments/
  arc-testnet.json              # chain, contract, block, compiler, commit
```

Keep deployer credentials outside browser code and version control. The deployment manifest contains public data only. Add a root README, `.env.example`, lockfiles, and CI for contract tests, fixture parity, TypeScript checks, and frontend build.

## 9. Build milestones and acceptance gates

| Phase | Work | Done when |
| --- | --- | --- |
| 1. Mechanism proof | Reference model, conservation fixtures, admissible numerical range, evaluator error bounds | Sponsor/trader claims conserve collateral; parameter and tail handling are justified. |
| 2. Arc smoke test | Configure wallet/token/toolchain; exercise ERC-20 deposits and transfers | Network/token checks pass; approve/transfer and fee handling work on Arc's runtime. |
| 3. Core contracts | Create, trade, freeze, resolve/cancel, and individual claims | Unit, fuzz, invariants, and Arc-runtime tests pass; claim cost does not scale with history. |
| 4. User flow | Charts, previews, transaction states, wallet positions, operator controls | Two wallets independently trade, inspect receipts, and claim through the UI. |
| 5. Testnet release | Deploy, verify, publish public manifest and web build | Resolved and expired demo markets complete; escrow reconciles with all payouts. |
| 6. Production readiness | Mathematical/security review and verified oracle integration | Mainnet release remains blocked until reviews and integration checks are complete. |

Implement in that order. Do not spend time polishing charts before proving the accounting and evaluator. Estimate effort after phase 1, because reliable fixed-point evaluation is the main uncertainty.

## 10. Required validation

**Mechanism:** unchanged curve rejection; wider/narrower/same-mean/shifted-mean trades; minimum uncertainty; tails; normalization; worst permitted parameters; high-precision parity; repeated opposing trades; all claims in arbitrary order; cancellation refunds. Verify nonnegative payouts, backing bounds, fixed norm within the approved numerical tolerance, and market-by-market collateral conservation.

**Contracts:** stale nonce, expired quote, wrong market status, premature/late/unauthorized resolution, duplicate resolution/claims, invalid parameters, overflow/underflow, insufficient allowance, failed transfer, reentrancy, and many receipts. Fuzz the full lifecycle, not only individual math calls. Check that one market cannot spend another's escrow.

**Arc:** test on `arc-anvil --network arc` and actual testnet USDC. Confirm 6/18-decimal conversions, fee reservation, simulation, receipt reconciliation, and restricted-transfer failure behavior. Standard ERC-20 mocks alone cannot establish Arc compatibility.

**UI:** wallet disconnected/wrong chain, approval rejection, insufficient gas after approval, stale preview, transaction timeout/retry reconciliation, accessibility, and settlement/cancellation claims after a reload.

## 11. Demo definition of done

A fresh wallet can open the deployed dapp, acquire testnet USDC, change a continuous Gaussian forecast, inspect its exact receipt, and claim after a documented outcome. A second market expires and refunds deposits. Explorer source is verified, frontend and contracts agree on ABI/addresses, and all escrow reconciles after claims. The README explains the resolver trust and fixed `b` collateral requirement.

Mainnet is a later release. It needs independent math/security review, a verified scalar oracle strategy, operational recovery procedures, and assessment of the rules applicable to the intended launch jurisdiction. Those items are release work, not prerequisites to writing this plan or running a faucet-funded demo.

## 12. Known limits and next decisions

- Fixed `b` collateral and locked-until-settlement receipts make this MVP capital inefficient. Optimize only after the mechanism is verified.
- Gaussian forecasts are unimodal and may be a poor fit for bounded or skewed outcomes. Label that limitation and select the first market accordingly.
- The resolver can submit an incorrect value. Public evidence makes decisions inspectable but does not eliminate that trust.
- Numerical bounds, exact market rules, initial `b`/`k`, and library/compiler versions must be fixed in phase 1; the example values are not deployment parameters.
- No RPC transaction, deployed bytecode, or oracle availability was tested while preparing this document. Recheck network configuration before deployment.
