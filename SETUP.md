# Setup and verification

Updated: 10 October 2026. The application, Solidity contracts, numerical reference, and local Arc demonstration are implemented. The public Arc Testnet manifest is intentionally unconfigured until a funded deployment is authorized and market observation rules are selected.

## Requirements

Use Node.js 22.12+ and npm. Python 3.12+ is required for the independent numerical reference. On Windows, the Arc local runtime uses WSL2 with Ubuntu 24.04 or later. The project downloads checksum-pinned Arc Foundry and Solidity tools into the ignored `work/` directory; it does not alter shell profiles or install tools into the user's home.

## Run the end-to-end local demo

From the directory containing the root `package.json`:

```powershell
npm ci
npm run demo
```

Open the localhost URL printed by Vite. The demo starts a disposable Arc runtime, deploys the contract, creates two clearly labeled synthetic fixture markets, and starts the app with unlocked local-only accounts. It exercises the same contract/UI flow: connect a wallet, approve exact collateral, change a forecast, inspect the receipt, resolve a market with the fixture resolver, claim positions and sponsor funds, and cancel the second market after expiry. These accounts and fixtures are local test data, not public-network identities or live observations.

On Windows, set `$env:ARC_WSL_DISTRO = 'Ubuntu'` if WSL uses another distro name. The node binds to loopback on port 8547. Press Ctrl+C to stop the demo. For separate terminals use `npm run tools:arc`, `npm run node:arc`, `npm run demo:seed`, and `npm run dev:local` in that order.

## Verify the project

With the local Arc runtime running, execute:

```powershell
npm test
npm run check
npm run build
npm audit --omit=dev
```

`npm test` checks 189 Solidity/Python parity fixtures, high-precision model bounds, lifecycle and adversarial integration against the actual local Arc runtime and native USDC predeploy, and Arc Foundry unit/fuzz/runtime tests. Each fuzz property runs 256 cases. `npm run check` validates TypeScript; `npm run build` emits `web/dist/`. Dependency and tool versions are pinned in the manifests and lockfile.

To exercise a browser wallet-to-receipt journey, start `npm run demo` and, in a second terminal, run `npm run test:browser`. It needs the Playwright Chromium binary (installed once with `npx playwright install chromium` if it is missing). The test uses only disposable localhost accounts and writes its screenshot to ignored `work/`.

## Public Arc Testnet

The default app configuration points to the actual deployed, source-verified Arc Testnet contract. Connect your own EVM wallet and switch to chain 5042002; faucet USDC pays both fees and collateral. No key is bundled in the app. Public receipts, genuine event rules and two-wallet acceptance evidence live under `deployments/`. `npm run dev:local` is explicitly separate and synthetic. Follow [the public release guide](docs/public-release.md) for public scripts and the mainnet sequence.

Never copy a local address, development private key, synthetic observation, or localhost manifest into public configuration. The local developer wallet is enabled only when the manifest is explicitly `local` and both the RPC and page resolve to loopback.
