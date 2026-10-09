# New project setup

Updated: 10 October 2026.

## Environment

Use Node.js 22.12 or later and npm. Setup was checked with Node `25.9.0` and npm `11.18.0`. React, Vite, and the TypeScript tooling are local dependencies, pinned in the manifests and root lockfile.

Run commands from this project folder, which contains the root `package.json`:

```sh
npm ci
npm run check
npm run build
npm run dev
```

The root uses an npm workspace for `web/`. Keep the single root lockfile; do not create a second dependency installation inside `web/`.

`npm run check` checks TypeScript. `npm run build` checks TypeScript and creates `web/dist/`. `npm run preview` serves that build locally. These commands validate the scaffold, not the planned financial mechanism.

## Configuration

The current setup screen does not connect to a blockchain and needs no environment file. `.env.example` records proposed public Arc settings for future contract tooling. If needed, copy it to ignored `.env` and verify the values against the official Arc docs before use.

Do not put secrets in `VITE_` variables: those are bundled into browser code. Do not fund or sign transactions just to run the scaffold.

## Contract tools

Arc Foundry was not available during setup and was not installed. Before phase 2, follow the official [installation instructions](https://docs.arc.io/arc/tutorials/install-arc-foundry.md) and [deployment workflow](https://docs.arc.io/arc/tutorials/deploy-on-arc). Confirm compiler and math-library compatibility before creating a Foundry configuration.

Contract directories are reserved but contain no Solidity implementation. Once tests exist, use the documented Arc-runtime mode, including `arc-forge test --network arc`. No contract-test script is provided until there are real tests to run.

## Next implementation steps

1. Read `Rules.md` and phase 1 in `Phases.md`.
2. Select exact numeric encodings and a reviewed math library.
3. Build the high-precision reference model and deterministic evaluator fixtures.
4. Prove safe numeric ranges, evaluator errors, and collateral conservation.
5. Verify Arc transfers/runtime, then implement tested escrow contracts.
6. Add wallet reads/writes and the product UI after those gates pass.

No private keys, fake contract addresses, wallet dependencies, deployment, or oracle integrations are included in the starter.
