# DAZZ Markets on Arc

DAZZ Markets is an end-to-end implementation of the continuous Gaussian distribution market in [Dave White's Paradigm paper](https://www.paradigm.xyz/writing/distribution-markets), deployed and source-verified on public Arc Testnet. Traders move an expected numeric outcome and uncertainty; the sponsor keeps the initial curve's value. Each change deposits the market's fixed `b` USDC. Individual receipts settle at a normalized scalar outcome. A trusted resolver, immutable hashed rules, UTC deadlines, and permissionless expiry cancellation determine finality.

Public contract: [0xc613bca497257cfec8d1754e1d81136cb9862ca8](https://explorer.testnet.arc.io/address/0xc613bca497257cfec8d1754e1d81136cb9862ca8?tab=contract). Real markets cover Premier League total goals and an exact Coinbase BTC/USD candle. Run `npm ci` and `npm run dev` to use this deployment with your own injected EVM wallet. The app never holds wallet private keys.

Choose **Fund test wallet** in the header, connect your wallet, copy its address, and open [Circle's official faucet](https://faucet.circle.com/). Select USDC and Arc Testnet, paste the address, and submit on Circle's page. Return to the panel and refresh the live balance. Test USDC pays both collateral and gas. The public-testnet funding action is hidden on mainnet and localhost. Circle currently supplies 20 test USDC every two hours per address/network; its CAPTCHA and limits apply.

The DAZZ interface includes searchable market cards, sports/crypto and settlement-status filters, onchain summary metrics, paired probability-density and P&L charts, keyboard-accessible controls, scenario inspection, positions, sponsor recovery, an operator flow, exact approvals, simulated/staleness-checked transactions, and hash reconciliation. It reads deployed records from Arc. Local demonstration markets are labeled synthetic. The Coinbase style imported from `coinbase/DESIGN.md` is active; the app does not bundle licensed Coinbase fonts or wordmarks.

## Run the complete local Arc demonstration

Requirements: Node.js 22.12+, npm, Python 3.12+, and (on Windows) WSL2 with a Linux distribution named `Ubuntu`. The demo script installs checksummed Arc Foundry and Solidity binaries only in `work/`.

```powershell
npm ci
npm run demo
```

Open the local URL printed by Vite. The script starts a disposable Arc runtime with its built-in local USDC, deploys the contract, funds two synthetic fixture markets and starts the app with local-only developer accounts. Use the operator account to create a separate market, then select the fixture resolver account to resolve it. Switch to the two trader accounts to make forecasts and claim. The second fixture expires for refund testing. These test accounts exist only on the localhost runtime; never use their addresses or any development key on a public network.

For separate steps, run `npm run tools:arc`, `npm run node:arc`, `npm run demo:seed`, and `npm run dev:local` in separate terminals. The default `npm run dev` uses the actual public Arc Testnet manifest. To stop a runtime, press Ctrl+C in its terminal.

## Reproduce the verification

```powershell
npm ci
npm run tools:arc
npm run node:arc
npm test
npm run check
npm run build
npm audit --omit=dev
```

Keep `node:arc` running in its own terminal during `npm test`. The checks include the 90-digit Python reference, onchain parity across 189 fixtures, adversarial and lifecycle integration against Arc's localhost runtime and native USDC predeploy, plus Arc Foundry unit/fuzz/runtime tests. Fuzzing runs 256 cases per fuzz property.

For a real-browser wallet-to-receipt smoke, start `npm run demo` and run `npm run test:browser` in a second terminal. It selects a disposable trader account, approves exact collateral, confirms a forecast trade, reloads the positions view, and writes a screenshot under ignored `work/`.

## Oracle health

Run `npm run oracle:health` to check Coinbase, Bitstamp, and Kraken BTC/USD minute candles without a wallet or transaction. New crypto markets commit an all-three health policy; the resolver blocks signing on missing/stale data or more than 1% spread. Cached settlement evidence is revalidated against its source archive and the contract normalization. Existing markets retain their committed rules. Run `npm run test:oracle` and see [docs/oracle-health.md](docs/oracle-health.md) for limits and operation.

Football sources are wired separately: run `npm run oracle:football` for readiness, then configure the three server-side provider keys and exact fixture mappings described in [docs/football-oracles.md](docs/football-oracles.md). New football markets require exact full-time score agreement across all three providers. Existing football markets retain their original official-source rules.

## Current release status

The local Arc lifecycle is exercised, including native USDC transfer/approval behavior, shared 6/18-decimal balance, restricted transfer rollback, claim recovery, two wallets, and cancellation. Public deployment, source verification, three genuine event markets, two funded trader-wallet receipts and browser acceptance are recorded under `deployments/arc-testnet-*.json`. The actual Coinbase candle closed at 82,583.69 USD; trader/sponsor claims paid exactly 3 USDC from 3 USDC deposited. A separate explicit recovery exercise expired and refunded exactly 2 USDC. The football markets retain 2 USDC backing, matching total liability.

The Arc Microgrants program requires mainnet and excludes testnet-only builds. Mainnet is configured separately and remains undeployed until actual mainnet USDC is provided. Testnet prerequisites are checked against source and evidence fingerprints. Public source is published at [debojyoti10CC/dass](https://github.com/debojyoti10CC/dass). See [docs/security-review.md](docs/security-review.md) and [docs/public-release.md](docs/public-release.md) for evidence and exact next steps. In-house review and automated scans are not an independent audit.

## Project files

- [IMPLEMENTATION.md](IMPLEMENTATION.md): completed decisions, build plan, acceptance boundary.
- [plan.md](plan.md): mechanism and product proposal.
- [PRD.md](PRD.md): requirements and release acceptance.
- [Architecture.md](Architecture.md): chain, contract, UI, and recovery design.
- [Rules.md](Rules.md): normative market/accounting rules.
- [Phases.md](Phases.md): current gate evidence and release status.
- [Memory.md](Memory.md): decisions and dated implementation evidence.
- [Design.md](Design.md): active Coinbase visual reference and app-specific adaptations.
- [reference/numeric-spec.md](reference/numeric-spec.md): arithmetic encodings, bounds, evaluator proof and caveats.
- [docs/arc-integration.md](docs/arc-integration.md): official network assumptions and actual RPC/runtime evidence.
- [docs/arc-runbook.md](docs/arc-runbook.md): testnet signer, deployment, verification, and demo workflow.
