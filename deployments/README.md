# Deployments

`arc-testnet.json` records the actual public deployed and source-verified contract. Associated JSON files contain actual receipts, market rules, separate trader-wallet acceptance, browser checks and source observation evidence. `arc-mainnet.json` is separate and remains undeployed. Never use an example/local address as a public deployment, and never store private keys here.

`arc-testnet-readonly-evidence.json` records actual public RPC chain, token and unit checks. `arc-local-smoke-evidence.json` records actual local Arc runtime approval/transfer results. `arc-runtime-test-evidence.json` and `arc-runtime-tests.txt` record ten passing Arc Foundry tests, including real native USDC restrictions and escrow. Their network scopes are explicit; a local result is not public testnet acceptance. See [Arc integration evidence](../docs/arc-integration.md) and the [release runbook](../docs/arc-runbook.md).
