# Distribution Markets on Arc

Project scaffold for a continuous Gaussian prediction dapp on Circle's Arc Testnet. The React/TypeScript app currently shows a setup-status screen. Markets, wallets, contracts, settlement, and oracle integration are not implemented.

## Start

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. Dependencies were installed when this project was created; `npm ci` reproduces the locked installation on a fresh checkout.

```sh
npm run check
npm run build
npm run preview
```

See [SETUP.md](SETUP.md) for the full environment and next-step checklist. Scaffold follows the [Vite setup documentation](https://vite.dev/guide/).

## Specifications

- [plan.md](plan.md): overall proposal and mechanism.
- [PRD.md](PRD.md): product requirements.
- [Architecture.md](Architecture.md): components and data flow.
- [Rules.md](Rules.md): behavioral and financial invariants.
- [Phases.md](Phases.md): implementation sequence and acceptance gates.
- [Design.md](Design.md): interface direction.
- [Memory.md](Memory.md): current context and evidence.

## Structure

```text
web/          React + TypeScript + Vite starter
contracts/    future Solidity sources, tests, deployment scripts
reference/    future high-precision math model and fixtures
deployments/  future public deployment manifests
```

The documents in this project folder are the working specifications; the original parent-folder documents are planning snapshots. Implement the phase 1 numeric proof before adding transaction flows. No deployment or mainnet configuration is included.
