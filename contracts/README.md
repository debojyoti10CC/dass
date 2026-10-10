# Contracts

`src/DistributionMarkets.sol` implements one non-upgradeable escrow contract, and `src/GaussianMath.sol` evaluates the bounded fixed-point Gaussian payout function using the pinned PRBMath dependency. Receipts are nontransferable and individually claimable; there is no admin withdrawal from market liabilities. The implementation rules, formulas, precision and assumptions are documented in the root `Rules.md` and `reference/numeric-spec.md`.

Run `npm run contracts:build` from the repository root to compile Solidity 0.8.30 (`viaIR`, Paris target, optimizer enabled) and generate the frontend ABI/config module. Run `npm run demo` for a disposable local Arc deployment. Test Arc runtime transfers and lifecycle behavior with `npm run test:forge` while `npm run node:arc` is running; `npm test` runs that suite together with reference and JavaScript lifecycle checks.

The public Arc Testnet manifest records a successful, source-verified deployment at `0xc613bca497257cfec8d1754e1d81136cb9862ca8`. Real Coinbase and football market rules are committed onchain. Mainnet uses a separate manifest and remains undeployed. See [the public release guide](../docs/public-release.md) and [security review](../docs/security-review.md). Internal GaussianMath and imported libraries are compiled into DistributionMarkets; test mocks and harnesses are not application deployments.
