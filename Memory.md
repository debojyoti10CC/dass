# Project memory — Distribution Markets on Arc

Last updated: 10 October 2026. This file records project context and evidence, not hidden instructions or completed work inferred from a plan.

## User requests

1. Prepare `plan.md` for a dapp based on [Paradigm's Distribution Markets article](https://www.paradigm.xyz/writing/distribution-markets), on Arc.
2. Create `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, and `Memory.md`.

The user first requested planning documents, then requested a new project folder and setup file. That authorizes the local scaffold and dependency setup. Wallet transactions, deployment, and publication have not been requested.

## What exists

| Artifact | Role | Current evidence |
| --- | --- | --- |
| [plan.md](plan.md) | Overall build proposal | Written during the first request. |
| [PRD.md](PRD.md) | Product scope and acceptance | Written for the second request. |
| [Architecture.md](Architecture.md) | Components, data, and transaction flow | Proposed design only. |
| [Rules.md](Rules.md) | Enforceable behavioral constraints | Proposed specification only. |
| [Phases.md](Phases.md) | Dependency order and release gates | All implementation phases not started. |
| [Design.md](Design.md) | Visual system and interaction behavior | No implemented UI or screenshots. |
| [Memory.md](Memory.md) | Context, decisions, and evidence | This document. |

The working project is `/Users/ahir/projects/distribution-markets-arc/`. Its root documents are the current specifications; parent-folder copies are earlier planning snapshots. A minimal React/TypeScript/Vite setup screen now exists in `web/`. Contract, reference, and deployment folders are reserved. No financial logic, wallet integration, Solidity implementation, reference model, deployment manifest, or application test suite exists.

## Research performed

Read the referenced article and current official Arc connection, contract-address, fee, deployment, and runtime documentation during the first request. Some `docs.arc.network` URLs redirected to `docs.arc.io`.

Documentation snapshot used for the proposal:

- Arc Testnet chain ID `5042002`.
- RPC `https://rpc.testnet.arc.io` and explorer `https://explorer.testnet.arc.io`.
- USDC ERC-20 interface `0x3600000000000000000000000000000000000000`.
- ERC-20 application accounting uses six decimals; native gas accounting uses 18 decimals, sharing the underlying USDC balance.
- Arc documentation recommends Arc Foundry and Arc-runtime tests.

These are researched configuration facts, not proof that a wallet or deployment currently works. Revalidate before implementation/deployment using [connection docs](https://docs.arc.io/arc/references/connect-to-arc), [token addresses](https://docs.arc.io/arc/references/contract-addresses), and [deployment docs](https://docs.arc.io/arc/tutorials/deploy-on-arc).

## Assumptions and proposed decisions

The following were chosen by the assistant as a coherent MVP and have not been individually approved as a final implementation specification:

| Decision | Reason |
| --- | --- |
| Arc means Circle's Arc | Context suggests a blockchain deployment; user has not clarified further. |
| Start on testnet | Smallest useful demonstration with faucet-funded settlement. |
| Gaussian-only curves | Compact continuous mechanism with a tractable evaluator. |
| Fixed trader deposit `D = b` | Sufficient collateral bound without an unverified minimum-loss solver. |
| Creator is sole sponsor | Avoids dynamic LP share accounting in the first release. |
| Sponsor retains initial curve ownership | Required to account for the starting nonzero curve. |
| One non-upgradeable contract | Small scope and no requested upgrade mechanism. |
| Trusted immutable resolver | Explicit testnet resolution policy; no verified oracle integration. |
| Individual nontransferable receipts | Avoids global claim loops and token/early-exit complexity. |
| Expiry cancellation refunds deposits | Provides recovery when resolution never arrives. |
| React/TypeScript/Vite and viem/wagmi | Proposed small EVM frontend; dependencies not installed. |
| Cool plotting workspace with paired charts | Makes uncertainty and financial consequences the main interaction. |

A weather observation is an example only. No source, station, event, timeline, actual backing, norm parameter, or resolver address has been selected.

## Accounting context to preserve

Each curve change owns its new-minus-old payout difference. Trader settlement adds back its deposit. Sponsor settlement includes both original-curve ownership and final AMM residual:

```text
trader_i = D_i + F(new_i, outcome) - F(old_i, outcome)
sponsor  = b + F(initial, outcome) - F(final, outcome)
```

Use the same deterministic integer `F` in every term. Values in `[0,b]` plus `D_i=b` ensure nonnegative claims. The telescoping sum equals tracked deposits. Keep each market's liability separate from direct donations and other markets.

Exact integer conservation is not a proof of accuracy against the analytic Gaussian or of a reviewed implementation. Numerical range/error certification remains phase 1 work.

## Validation actually performed

During the original plan preparation, a Python floating-point check confirmed the illustrative `b=10`, initial standard deviation `1`, proposed standard deviation `4` example, and multi-trade payout conservation/nonnegative payouts at seven sample outcomes. The example gives trader `5` and sponsor `15` at the shared mean from `20` total deposits.

That check is illustrative, not Solidity testing, formal proof, high-precision parity, or an audit. No RPC transactions, oracle availability checks, bytecode deployments, wallet approvals, or contract tests have been performed.

Document checks passed for all six requested files and the original plan: nonempty content, balanced Markdown fences, and valid local cross-links. The MVP scope and settlement semantics were reviewed for consistency. Record implementation test results only after tests actually run.

## Open implementation decisions

- Observation source, publication/revision policy, units, precision, and raw-value encoding.
- Supported numeric ranges, normalization scale, backing `b`, and norm parameter `k`.
- Reviewed fixed-point math library and compatible compiler/tool versions.
- Resolver/operator wallets and durable rules/evidence storage.
- Gas/receipt behavior under actual Arc runtime and testnet conditions.
- Production scalar oracle, independent review, and launch requirements, if later requested.

No implementation schedule or production launch date has been committed.

## Next work

If asked to implement, begin with [Phases.md, phase 1](Phases.md): reference model, deterministic evaluator, safe numeric ranges, and conservation/error fixtures. Then verify Arc integration before custody contracts and frontend execution.

Keep deferred features deferred. If a decision changes, update the owning specification and references; mark previous assumptions superseded rather than leaving contradictory instructions. Append dated entries with the decision, reason, affected artifacts, and actual verification evidence.

## 10 October 2026 — Project scaffold

Created the named project folder, copied the seven planning documents, added README/SETUP instructions, npm workspace manifests, a React/TypeScript/Vite setup screen, ignored environment example, and reserved contract/reference/deployment folders. Financial implementation phases remain unstarted. Dependencies were installed and all direct versions pinned in the workspace manifest and root lockfile. `npm run build` passed TypeScript checks and the Vite production build. A local dev-server smoke check returned HTTP 200 for the page and transformed React entry module. Document links and Markdown fences passed checks. No browser visual QA or financial tests were run. Arc Foundry is unavailable on PATH and has not been installed.

## 10 October 2026 — Project location

At the user's request, moved the complete project to `/Users/ahir/projects/distribution-markets-arc/`, including dependencies and lockfile. Original planning snapshots remain in the prior workspace outputs directory.

Project location corrected to `/Users/ahir/projects/distribution-markets-arc/` at the user's request.
