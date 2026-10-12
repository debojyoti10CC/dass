# BTC five-minute Up / Down

New direction markets use the existing DistributionMarkets contract. Only two settlement outcomes are admissible: `0` (Down) and `1` (Up), with a step of one and a fixed forecast width of 0.5. Each forecast change deposits the market's fixed USDC collateral. Receipts retain the Gaussian payout formula; these are not fixed-price binary shares or implied probabilities.

Trading closes at the observation window's start. The resolver reads the committed Chainlink BTC/USD feed at the first source-chain block at or after each UTC boundary, exactly 300 seconds apart. It compares the integer answers: ending price equal to or greater than starting price resolves Up; a lower ending price resolves Down. An unchanged feed round therefore resolves Up. Historical blocks can land slightly after their target boundaries; the target window remains exactly five minutes.

Both archived rounds are checked against historical chain state before signing. Missing historical state, stale or invalid rounds, or inconsistent evidence blocks resolution. After the resolution deadline anyone may cancel, and every original deposit is refundable. Arc testnet uses the committed Arc mainnet source feed through a trusted off-chain resolver; the contract does not verify a cross-chain relay.

## Checks

```sh
npm run test:oracle
npm run test:btc:browser
npm run check
npm run build
```

The BTC browser test starts an isolated disposable Arc runtime and frontend on ports 8557 and 5181. Install the Arc tools first with `npm run tools:arc` if needed. It replays a completed historical live Chainlink window on a local chain clock, trades both directions with two wallets, reloads positions, resolves and claims, then exercises expiry refunds. Its evidence is saved under `work/btc-direction-browser-e2e.json`; local transactions do not prove public deployment.

## Live testnet signing

```sh
npm run contracts:build
npm run test:public:btc -- --check
npm run test:public:btc
```

The read-only check sends no transactions. The signing workflow serves `http://127.0.0.1:8791` for the configured funded browser account, and journals each transaction before requesting a signature. It deploys a separate test contract, creates and trades a direction market, waits for the genuine five-minute source window, resolves, and claims trader and sponsor receipts. Its evidence and transaction journal are separate from the earlier numeric-price test. Never restart an unknown transaction or silently move an already committed window.

The existing published testnet deployment and its older markets remain separate. A hosted frontend containing direction controls is not evidence of a live direction market: that requires confirmed market-creation, trade, resolution, and claim receipts.
