# Product requirements — DAZZ Markets on Arc

Status: implemented application with completed public Arc Testnet deployment and settlement/refund acceptance; mainnet funding/publication pending. Updated: 10 October 2026.

## Purpose

Let people trade a forecast for a numeric outcome by changing its expected value and uncertainty. Show how that change pays at different outcomes, settle in USDC, and make collateral and resolution rules understandable before a transaction.

This project follows [the existing plan](plan.md) and [the Paradigm Distribution Markets paper](https://www.paradigm.xyz/writing/distribution-markets). “Arc” means Circle's Arc blockchain. The app, contracts, numerical reference, and Arc runtime acceptance suite are implemented. The public Arc Testnet contract is deployed and source-verified, with genuine event markets and separately funded trader wallets. The user authorized mainnet for Arc Microgrants after public testnet testing and security checks; actual mainnet funding remains necessary.

## Audience and jobs

| Actor | Job | Successful outcome |
| --- | --- | --- |
| Trader | Express a different forecast | Understand and submit a Gaussian curve change, then inspect the resulting position. |
| Sponsor/operator | Fund and create a market | Publish immutable observation rules, initial forecast, backing, and deadlines. |
| Resolver | Report the final observation | Submit an admissible scalar outcome with evidence within the permitted window. |
| Position owner | Recover settlement funds | Claim a payout after resolution or a deposit refund after cancellation. |

The operator is the initial sponsor. Each market has one immutable, trusted resolver. These roles may share a wallet in the demo, but their permissions remain distinct.

## Release scope

Support continuous Gaussian forecasts, one sponsor per market, nontransferable position receipts, operator-created markets, explicit USDC approvals, individual claims, and permissionless expiry cancellation.

Every trade replaces the current curve and deposits the market's fixed backing amount `b`. There is no variable stake-size control. Each receipt remains open until resolution or cancellation; a later opposite trade creates another receipt rather than closing the first.

Start with a short-lived numeric observation market, such as a specified weather-station temperature. That is an example, not a selected source or live event. Before launch choose the source, exact field, observation time, publication/revision rule, units, precision, normalization, and missing-data behavior.

## Functional requirements

| ID | Requirement | Acceptance condition |
| --- | --- | --- |
| P01 | Wallet and network onboarding | Users can connect, switch to Arc Testnet, copy the connected address, open Circle's official faucet, refresh the live test USDC balance, and see deposit plus fee requirements. The funding action is limited to public testnet. |
| P02 | Market discovery | Users can inspect question, status, expected outcome, uncertainty, and close time without connecting. |
| P03 | Rules inspection | Source, timestamps, units, resolver, evidence policy, and cancellation deadline are visible before trading. |
| P04 | Forecast editor | Mean and standard deviation have numeric inputs and keyboard-operable sliders with validated bounds. |
| P05 | Trade preview | Current/proposed probability curves and receipt P&L are separate; fixed collateral and gas are explicit. |
| P06 | Execution | Approve only the required amount; simulate; submit with expected market nonce, maximum deposit, and expiry. |
| P07 | Stale preview protection | If the market changes, stop submission and show a refreshed preview requiring another user action. |
| P08 | Positions | Show receipt owner, old/new forecast, deposited amount, status, and claimable payout/refund. |
| P09 | Settlement | Only the configured resolver can finalize once, after close and before the resolution deadline. |
| P10 | Expiry recovery | Anyone can cancel an unresolved market at expiry; owners can reclaim original deposits. |
| P11 | Transaction recovery | Persist transaction hashes locally and reconcile unknown outcomes against chain state after reload. |
| P12 | Sponsor recovery | Sponsor can claim its economic entitlement after resolution or original backing after cancellation. |

## Financial presentation

A deposit is collateral, not a fee. A receipt payout includes returned collateral. P&L is payout minus deposit; transaction fees are separate. The interval `0` to `2b` is a conservative payout bound, not a prediction of returns or an exact attainable range.

Probability density is not the probability of an exact outcome. A Gaussian's standard deviation describes uncertainty; it does not change the deposit. Initial sponsor ownership must be included in accounting and explained in sponsor-facing copy.

## Quality requirements

Settlement must conserve tracked collateral, remain independent of claim order, and never draw on another market's escrow. Individual claims must not iterate over historical trades. Transfer failures must preserve claim rights.

Support mobile layouts, labeled charts, visible focus, screen-reader summaries, text equivalents for P&L colors, and reduced motion. Transaction messages distinguish rejection, revert, pending, confirmed, and unknown outcomes.

A trusted resolver may report a wrong value. Disclose that trust on the market page and preview. Do not call the demo trustless.

## Out of scope

Permissionless creation, live LP changes, multiple distribution families, optimal collateral, transferable position tokens, early exits, protocol fees, bridging, embedded wallets, sponsored gas, governance, and a dedicated backend/indexer.

## Release acceptance

Demonstrate two wallets changing the same market, stale-preview rejection, verified resolution/evidence, trader and sponsor claims, and escrow reconciliation. Demonstrate a second market expiring and refunding all deposits. Reload the browser and recover positions and transaction status.

The user expanded scope to mainnet after public testnet testing and security review. No mainnet transaction has been sent. [Phases.md](Phases.md) defines remaining production gates. [Rules.md](Rules.md) defines enforceable behavior; [Design.md](Design.md) defines the interface. Acceptance demonstrated in the local Arc runtime is documented in [Memory.md](Memory.md) and [docs/arc-integration.md](docs/arc-integration.md); public wallet funding and source-based settlement/refund acceptance are complete. Mainnet needs actual USDC and deployment/publication checks.
