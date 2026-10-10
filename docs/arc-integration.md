# Arc integration and observed evidence

Checked on 10 October 2026 (Asia/Kolkata). The default app reads the actual public Arc Testnet deployment. Mainnet is configured separately and verified read-only; it has not been deployed.

## Network and units

Use chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`, and USDC interface `0x3600000000000000000000000000000000000000`. The app uses ERC-20 micro-USDC, six decimals, for collateral and claims. Native balances and gas use eighteen decimals. One micro-USDC equals `10^12` native units; both interfaces read the same underlying balance. The ERC-20 view floors residual native dust. Display one USDC balance, and reserve fees before spending collateral. [Official connection configuration](https://docs.arc.io/arc/references/connect-to-arc), [contract addresses](https://docs.arc.io/arc/references/contract-addresses), and [native token model](https://docs.arc.io/arc/concepts/stablecoin-native-model).

Coordinates, sigma, origin, scale, and norm `k` use WAD (`10^18`). The resolver passes a **normalized WAD outcome** to `resolve`; it does not pass a raw observation. The conversion is the exact rational `(rawWad - originWad) * 1e18 / scaleWad`, rounded to the nearest multiple of `outcomeStep`, with halfway ties away from zero. The contract's `normalizeOutcome` helper performs this conversion. Commit origin, scale, step, units, rounding, source, and observation time before funding a market. See the numeric specification for admitted ranges.

## Runtime behavior

Arc's current EVM baseline is Osaka. This project compiles with Solidity `0.8.30`, Paris bytecode, optimizer 200 runs, and `viaIR=true`, which uses an older compatible opcode set. Arc Foundry release `v0.8.0-2` reports Foundry `1.7.1-dev`, commit `d497beea7096ff2a8e583c8b307941f24a61b06b`. A standard EVM node is supplemental evidence only; this repository's local integration target is the actual Arc node mode. [Official runtime differences](https://docs.arc.io/arc/references/evm-differences).

Set `maxFeePerGas` to at least `20_000_000_000` native units per gas (20 Gwei), then account for current fee data. A transaction below the floor can disappear without an error receipt. Check shared balance against `collateralMicro * 1e12 + gasLimit * maxFeePerGas`, and recheck after approval. Receipt timeout means an unknown outcome; inspect both transaction hash and contract events before offering another submission. One included receipt is final. Block timestamps can repeat, so sort logs by block number and log index. [Official fee parameters](https://docs.arc.io/arc/references/gas-and-fees) and [transaction lifecycle](https://docs.arc.io/integrate/wallets/transaction-lifecycle).

Runtime-restricted transfers may revert even with sufficient funds; failed transfer calls must roll back claim flags and accounting. The market contract uses ERC-20 safe calls and contains no native value send or `SELFDESTRUCT`. Production blocklist handling is not established by an ordinary token mock. [Official transfer restrictions](https://docs.arc.io/arc/references/evm-differences).

An ERC-20 transfer emits both a six-decimal `Transfer` from the token interface and an eighteen-decimal `Transfer` from system emitter `0xfffffffffffffffffffffffffffffffffffffffe`. These represent the same movement. Discover positions from this application's own `CurveChanged` events, and never add the two token streams together. Gas deductions are calculated from `receipt.gasUsed * receipt.effectiveGasPrice`, not Transfer events. [Official system event specification](https://docs.arc.io/arc/references/usdc-system-events).

## Actual checks

`deployments/arc-testnet-readonly-evidence.json` records a public RPC read at block `66380112`: chain ID matched, USDC decimals were six, token code existed, native/ ERC-20 balance conversion matched, client reported `arc/v1`, and gas price was `25_000_000_000`. The observed balance belongs to the public token interface address; it is not a funded project wallet. These reads do not demonstrate public approvals, transfers, deployment, or end-to-end acceptance.

`deployments/arc-local-smoke-evidence.json` records approval and a `0.1 USDC` ERC-20 transfer on the disposable local Arc runtime. The exact allowance read back as `100000` micro-USDC and the recipient gained that amount. Both expected transfer emitters appeared. The script reserved eighteen-decimal gas, saved submitted hashes before waiting, and reconciled confirmed receipts. The local node is not public Arc Testnet; its receipt fees are recorded as returned and are not asserted to predict public transaction cost.

`deployments/arc-runtime-test-evidence.json` and `deployments/arc-runtime-tests.txt` record **10 passing Arc Foundry tests**, zero failures, and three fuzz tests with 256 runs each. The five native-runtime tests use Arc's real USDC predeploy: shared balance/dust, both event precision streams, zero-address restrictions, resolved/cancelled market escrow, and a real blocklist failure preserving a claim followed by recovery after unblocking. The remaining suite exercises randomized accounting/conservation, cancellation, evaluator bounds, normalization/aligned-outcome validation, and mock transfer failure. Tests fork only the disposable local Arc node and record hashes of the exact working source.

The downloaded Linux Arc archive SHA256 was `088bdb96a84418b757f9825d491e702792f1d1d1e29a9145af305a6600a79556`; the upstream checksum matched. Native Solidity `0.8.30` SHA256 was `f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7`, checked against Solidity's official compiler list. Arc Foundry compiled the source successfully with this compiler and ran the recorded tests.

## Repeat the read-only check

```powershell
node scripts/arc-smoke.mjs --output work/arc-public-check.json
node scripts/arc-smoke.mjs --address <PUBLIC_WALLET_ADDRESS> --spender <MARKET_CONTRACT_ADDRESS>
node scripts/arc-smoke.mjs --receipt <TRANSACTION_HASH>
```

The script never reads a private key. Without `--send`, it only calls public JSON-RPC read methods. A null receipt is reported as pending or unknown, not failure.

## Completed public testnet and remaining mainnet evidence

The public testnet manifest records the actual verified contract, successful receipt and source fingerprint. Separate deployment/acceptance/resolution/expiry evidence records actual fees, two funded wallets, the exact Coinbase observation, 3 USDC resolved payouts and 2 USDC expiry refunds. Contract token balance matches total liability: 2 USDC football backing. Source is published at https://github.com/debojyoti10CC/dass. Mainnet funding/deployment/wallet acceptance and public hosting/source remain open.

The tool installer also downloads the pinned Solidity 0.8.30 macOS universal binary (compatible with Apple Silicon), verifying SHA256 `738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683`.

## Browser RPC recovery

Discovery reads 20 markets per page using the deployed marketCount getter. Category/search filters and summary totals apply to the current page. Receipt/claim and sponsor queries filter indexed owner/sponsor topics; market activity filters indexed marketId. Confirmed event ranges are cached incrementally per filter. First loads still scan block ranges from deployment; an external indexer would be needed to eliminate those range requests on very old deployments. The browser paces reads and falls back from the manifest RPC to https://rpc.blockdaemon.testnet.arc.io only for a deployed public Arc Testnet manifest. Circle lists that endpoint in its [official node guide](https://github.com/circlefin/arc-node/blob/main/docs/running-an-arc-node.md). Chain ID 5042002, deployed runtime-code hash and the first 5,000-block event range match the actual deployment in deployments/arc-testnet-rpc-evidence.json. Mainnet and localhost retain their configured RPCs. Read-only preparation stops after 35 seconds; wallet approval and submitted-transaction reconciliation keep their own lifecycle.
