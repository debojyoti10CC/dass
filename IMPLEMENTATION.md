# Implementation and acceptance plan

Date: 10 October 2026. Source baseline: `wolf1276/dass`, original `main`.

The target is the repository's faucet-funded Arc Testnet MVP based on Dave White's [Distribution Markets](https://www.paradigm.xyz/writing/distribution-markets). Continuous Gaussian curves retain a fixed L2 norm. A receipt owns its new-minus-old outcome function. Every trade deposits the market's fixed backing, and the initial sponsor keeps the original curve plus the final AMM residual. This conservative collateral choice is an explicit MVP restriction, not the paper's minimum-collateral optimization.

## Decisions

- Keep React, TypeScript and Vite; use viem and an injected EVM wallet. No backend, factory, proxy, LP token, or early exit.
- Use one immutable escrow contract, one pure evaluator, PRBMath 4.1.0 and OpenZeppelin safe token/reentrancy primitives. Compile Solidity 0.8.30 with optimizer 200, via IR, Paris EVM.
- Coordinates and norm use 18-decimal fixed point; deposits and payouts use integer six-decimal USDC. Freeze normalization and supported bounds at market creation.
- Import `coinbase/DESIGN.md` using the user's getdesign command. Apply its visual system while preserving accessible paired density/P&L plots and financial disclosures.
- Keep Arc deployment configuration visibly undeployed until a real deployment has a receipt and manifest. Provide a read-only sandbox and a reproducible local chain demonstration.
- Testnet release now has actual public Arc deployment, source verification and real-event transaction evidence. The user expanded scope to mainnet for Arc Microgrants after completing testnet/security checks. Mainnet remains undeployed pending actual USDC funding and the remaining release evidence; no independent audit is claimed.

## Work and checks

1. **Numerical proof:** produce a high-precision independent reference, source-derived error budget, tails/bounds, backing margin, Solidity parity, conservation and cancellation fixtures. Stop and narrow bounds if error exceeds one micro-USDC.
2. **Arc checks:** verify public chain ID, USDC address/decimals and documented fee behavior. Install project-local Arc Foundry through WSL on Windows. Exercise exact approvals/transfers and failures on its local Arc runtime. Keep funded public-wallet evidence as a separate release requirement.
3. **Contract lifecycle:** implement creation, nonce-protected trades, exclusive close/resolve/cancel boundaries, individual trader/sponsor claims and per-market/global liabilities. Test permissions, adversarial transfers, reentrancy, stale/expired submissions, randomized lifecycles, claim order and bounded claim gas.
4. **Application:** implement discovery, editor/review, positions and operator actions against generated ABI. Verify committed rules, exact approvals, simulation, fee reserve after approval, stale preview renewal, pending/unknown reconciliation and reload recovery. Inspect desktop/mobile and keyboard operation.
5. **Delivery:** run reference, contract, type and production-build checks; document results in `Phases.md` and `Memory.md`. Include local setup, release runbook, public manifest schema and testnet evidence checklist. Public deployment/hosting is complete only after its actual checks pass.

## Acceptance boundary

Local completion means a fresh checkout reproduces the build and tests, two local wallets trade and recover claims, sponsor/trader payouts reconcile exactly, a second market expires/refunds, and the interface uses authoritative records. A successful local demo does not establish an independent audit or public Arc Testnet release. Any missing external gate is recorded with its exact prerequisite rather than labeled complete.
