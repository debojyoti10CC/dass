# Interface design — Distribution Markets on Arc

Status: proposed design specification; no UI or visual QA completed. Updated: 10 October 2026.

## Direction

Design a forecasting instrument for people comparing uncertainty, with the curve as the main interaction. The market page's job is to let a trader understand and submit one forecast change with its financial consequences.

Use a cool, quiet plotting workspace with a large aligned forecast/P&L chart pair. Avoid decorative trading-terminal widgets, generic KPI cards, and a promotional landing-page hero. The memorable element is a shared outcome cursor: move or keyboard-step it to see the forecast change and the corresponding receipt P&L at the same outcome.

The cursor's readout is a scenario, not a forecast of the eventual result. The editor's mean changes where the curve is centered; uncertainty changes its width. Neither changes deposit size.

## Tokens

| Role | Token | Use |
| --- | --- | --- |
| Workspace | `#EEF3F7` | Cool pale background. |
| Surface | `#FFFFFF` | Chart and editor surfaces. |
| Ink | `#15283B` | Body text and key values. |
| Muted ink | `#526477` | Secondary labels; verify contrast in context. |
| Current forecast | `#66788A` | Dashed current-curve stroke. |
| Proposed forecast/action | `#2454A6` | Solid proposed curve and primary buttons. |
| Gain | `#176451` | Positive P&L with plus signs and labels. |
| Loss | `#A23D4A` | Negative P&L with minus signs and labels. |
| Border/grid | `#D5DEE7` | Nonessential boundaries and chart grids. |

Proposed fonts: **Barlow Condensed** for market titles, **Source Sans 3** for body/forms, and **IBM Plex Mono** for data. Self-host only the required weights; fall back to system sans/monospace. Use tabular numbers. Type scale: 32/24/18/16/14 px; no essential financial text below 14 px.

Use an 8 px spacing rhythm, 8 px surface radii, and thin separators. At desktop width, cap content around 1280 px. Use a broad plot column and a 320–360 px editor column; at narrow widths, stack in reading order. Minimum interactive target is 44 px. Validate contrast, focus, and responsive behavior during implementation; token choices alone do not prove accessibility.

## Market detail layout

```text
[Markets]  [My positions]                  [Arc Testnet] [Connect wallet]

Market question                                         [Open / Closed]
Observation time · units · close time
[View resolution rules]  Trusted resolver: 0x…

+------------------------------------------------+----------------------+
| Forecast                                       | Change your forecast |
| current dashed / proposed solid                | Expected outcome     |
| probability density, labeled outcome axis      | [numeric] [slider]   |
| shared scenario cursor                         | Uncertainty          |
+------------------------------------------------+| [numeric] [slider]   |
| Your P&L at each possible outcome               |                      |
| zero line, gain/loss signs and text             | Fixed collateral     |
| same outcome axis and cursor                   | Gas estimate         |
+------------------------------------------------+| Settlement timing    |
| At selected outcome: P&L / settlement payout    | [Review forecast]    |
+------------------------------------------------+----------------------+

[Rules, source, resolver, deadlines]  [Recent curve changes]
```

Chart probability density and monetary P&L in different panels with synchronized x axes. Do not overlay incompatible units on one unlabeled axis. Curve legends use line style plus color. Positive/negative fills supplement numeric signs and labels.

Provide explicit axes, units, numeric readouts, and a screen-reader summary. Offer numeric scenario selection for users who cannot drag. Show an interval probability only when computed correctly and clearly labeled. Do not label a point density as a percent probability.

The visible chart window can adapt to old/new curves, with offscreen-tail disclosure. It must not imply that outcomes outside the viewport pay zero. Exact settlement uses the contract evaluator; sampled SVG data are approximate previews.

## Trade interaction

1. Edit expected outcome and uncertainty; validate inline without sending transactions.
2. Review old/new forecast, fixed collateral, illustrative P&L, gas, deadlines, and trusted resolution.
3. If necessary, choose **Approve USDC** and wait for confirmation.
4. Refresh state and simulation, then choose **Submit forecast**.
5. Confirm the receipt ID and provide **View position** and explorer links.

When another trade changes the market, mark the preview stale and offer **Refresh preview**. Preserve draft inputs, recompute their relationship to the new curve, and require a new submission action.

Use buttons that describe the next actual action, not “Bet” or “Buy” when the app replaces a forecast curve. Avoid automatic wallet prompts on page load.

Example copy:

- “Every forecast change deposits {b} USDC. This is collateral, not a fee.”
- “Funds remain locked until this market resolves or expires.”
- “This market uses a trusted resolver. Review the source and rules.”
- “The market changed. Refresh to review your new payout curve.”
- “Transaction status is unknown. Check its hash before submitting again.”

## Other screens

**Markets:** compact rows with the full question, expected outcome, uncertainty, close time, and status. A small curve thumbnail is supplementary. Empty state says “No markets yet” and explains that the operator creates them.

**My positions:** wallet-owned receipt rows with deposited USDC, old/new forecast summary, state, and payout/refund. Keep **Claim payout** or **Claim refund** reachable without opening a chart. Show deposited collateral and P&L separately; transaction fees are not included in P&L. Empty state links to markets.

**Operator:** structured creation form with immutable-rules review, sponsor funding summary, and wallet-role check. Resolution form shows the committed observation requirements, scalar value, evidence commitment, and finalization warning. Treat wrong role as a clear permission message; contract enforcement remains authoritative.

## State presentation

| State | Presentation and next action |
| --- | --- |
| Disconnected | Read-only charts/rules; connect when taking an action. |
| Wrong network | Explain required network; offer switch. |
| Invalid curve | Inline reason and supported range; preserve input. |
| Insufficient funds | Show collateral plus fee estimate; link faucet. |
| Pending | Transaction hash, active status, no duplicate-submit action. |
| Unknown | Reconcile by hash/state; no assumed success or failure. |
| Closed | Editor disabled; show resolver window/deadline. |
| Resolved | Outcome, source/evidence, receipt payout and claim action. |
| Expired unresolved | Explain cancellation eligibility; offer cancel. |
| Cancelled | Refund amounts and individual claim actions. |
| Claimed | Confirm amount and transaction; no second claim button. |
| Metadata unavailable | Show verified onchain fields and availability error; preserve claims. |

## Motion, accessibility, and review

Use brief curve transitions only when they clarify a changed draft; do not morph a stale preview into a tradable state silently. Disable transitions under reduced motion. No ambient effects, price tickers, or countdown urgency styling.

Before shipping, inspect desktop and narrow mobile screens, keyboard-only editing/claims, zoomed text, visible focus, contrast, screen-reader summaries, error states, and reduced motion. Review displayed payoff values against fixtures and contract claim previews. The shared outcome cursor is the single signature element; keep surrounding UI restrained.

The cool plotting workspace and aligned charts were chosen because the central task is inspecting uncertainty and payoff together. [PRD.md](PRD.md) sets behavior; [Rules.md](Rules.md) prevents misleading financial labels.
