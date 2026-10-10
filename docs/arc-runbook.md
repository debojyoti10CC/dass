# Arc development and testnet release runbook

## Install project-local tools

Install npm dependencies with `npm ci`, then run:

```powershell
node scripts/install-arc-tools.mjs
node scripts/arc-node.mjs
```

The installer downloads pinned Arc Foundry `v0.8.0-2`, checks its published SHA256, and extracts `forge`, `cast`, and `anvil` into `work/arc-foundry/`. On Linux x64 and Windows/WSL x64 it also installs a checksummed native Solidity `0.8.30` compiler into `work/solc/`. No shell profile or home-directory install is required. The filenames are those shipped by Arc; this runbook's `./work/arc-foundry/forge` is the Arc fork.

Windows requires WSL with a modern Linux distribution. Set `$env:ARC_WSL_DISTRO = 'Ubuntu'` to choose a distribution; the local machine's Ubuntu 26.04 works. Ubuntu 22.04 fails because this Arc binary requires GLIBC 2.38/2.39. Use Ubuntu 24.04 or newer. The node runner binds only `127.0.0.1:8547`, starts `--network arc --chain-id 5042002`, and suppresses development key output. Change the local port with `ARC_LOCAL_PORT`. Development accounts are disposable and must never receive public-network funds. [Official installation guidance](https://docs.arc.io/arc/tutorials/install-arc-foundry).

In a second terminal:

```powershell
$env:LOCAL_RPC_URL = 'http://127.0.0.1:8547'
npm test
node scripts/arc-forge-test.mjs
node scripts/arc-smoke.mjs --rpc http://127.0.0.1:8547
```

Use Linux/WSL from the repository root for the Foundry build and tests:

```bash
cd contracts
../work/arc-foundry/forge build --use ../work/solc/solc-0.8.30 --offline
../work/arc-foundry/forge test --network arc --use ../work/solc/solc-0.8.30 --offline --fork-url http://127.0.0.1:8547 --no-storage-caching
```

The tests fork only the disposable local Arc node, so the native USDC predeploy and real runtime transfer restrictions are available while each test runs in isolated memory. They submit no transaction to public Arc Testnet. RPC storage caching is disabled to avoid home-directory writes. The portable test runner saves its raw results to `work/arc-forge-tests.log`. The pinned compiler binary avoids automatic home cache downloads. macOS arm64/Linux arm64 can run the Arc binaries, but the native compiler must be supplied separately with `--use` or use the npm compilation command. Stop the local node with Ctrl+C after verification.

## Explicit local approval/transfer smoke

The script optionally talks to an already configured wallet RPC exposing an unlocked account. It never accepts keys. This example uses the disposable local node only:

```powershell
node scripts/arc-smoke.mjs --rpc http://127.0.0.1:8547 --send --confirm-testnet-transactions --wallet-rpc http://127.0.0.1:8547 --account 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 --spender 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc --recipient 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 --amount 100000 --output work/arc-local-check.json
```

It requires exact positive micro-USDC between one unit and one USDC, validates both RPC chain IDs, simulates via gas estimation, checks gas headroom, approves exactly the amount, verifies allowance, transfers, and verifies the recipient delta. Submitted hashes persist to `work/arc-smoke-transactions.json` before confirmation. If a receipt is unavailable, reconcile the stored hash before repeating the action. The approval remains until consumed or revoked. This smoke does not prove `transferFrom` or market escrow; use lifecycle tests for those.

## Prepare a public testnet deployment

1. Complete numerical, contract, Arc runtime, UI, and lifecycle gates. Run the read-only public RPC smoke and review its captured evidence.
2. Commit reviewed source. Choose a funded deployer and operator; choose resolver/source/UTC observation rules before market creation. Obtain faucet USDC from [Circle Faucet](https://faucet.circle.com) with an EVM wallet configured for chain `5042002`.
3. Keep signing credentials in an external signer or encrypted Foundry keystore outside browser code. Never put a key in the manifest, CLI arguments, chat, or tracked files. Use a hardware signer or `--keystore <ENCRYPTED_KEYSTORE_PATH>` with interactive password entry. The Solidity deploy script only reads the public `ARC_OPERATOR_ADDRESS`.
4. Set `ARC_TESTNET_RPC_URL` and `ARC_OPERATOR_ADDRESS` in the Linux/WSL shell. Check current gas data; the maximum fee must meet the 20 Gwei floor and current base fee.
5. Dry-run from `contracts/` with a public sender address before broadcasting:

```bash
../work/arc-foundry/forge script script/Deploy.s.sol:Deploy \
  --network arc --use ../work/solc/solc-0.8.30 \
  --rpc-url "$ARC_TESTNET_RPC_URL" --sender <PUBLIC_DEPLOYER_ADDRESS>
```

The script enforces Arc Testnet chain ID and the immutable USDC interface. A dry-run is a simulation; it is not a deployment.

6. After the operator chooses to spend faucet funds, repeat the reviewed command with an external signer or encrypted keystore, `--broadcast`, and a current `--with-gas-price` maximum fee. Reconcile the broadcast record by transaction hash if a receipt is delayed. Do not treat a timeout as permission to redeploy.
7. Record the actual successful receipt's contract address, deployment transaction and block, operator, compiler/settings, exact source commit, and source verification URL in `deployments/arc-testnet.json`; set status to `deployed` only then. Confirm token and operator getters, code at the address, chain ID, and manifest consistency.
8. Verify source using the explorer workflow in [Deploy on Arc](https://docs.arc.io/arc/tutorials/deploy-on-arc). Preserve the exact compiler and constructor arguments. No verified-source claim is valid until the explorer accepts it.
9. Regenerate ABI/config with `npm run contracts:build`, build the app, and check the deployed contract before publication. Save public URLs and deployment evidence. Do not substitute an example address or local-node address for a real deployment.

## Public acceptance demonstration

Create a short testnet market with immutable source rules, trusted resolver disclosure, normalization, exact close time and resolution deadline. Record sponsorship and two different trader-wallet receipts; provoke a stale nonce and show the UI requires a fresh action. Wait until close, archive the observed source evidence, and submit the canonical normalized WAD outcome from the configured resolver. Claim both trader receipts and the sponsor claim in a different order, and verify `paid == deposited`, `totalLiability` reduction, and actual contract USDC balance.

Create a second market, trade, leave it unresolved through `resolveBy`, cancel permissionlessly, and claim original deposits and sponsor backing. Confirm zero market P&L and no cross-market liability use. Reload a fresh browser, recover wallet positions and transaction states, and exercise claims when rules metadata is unavailable. Capture explorer transaction links and evidence commitments for every acceptance action. These public actions have been performed: inspect deployments/arc-testnet-acceptance-evidence.json, arc-testnet-resolution-evidence.json and arc-testnet-expiry-evidence.json. Resolution/claims conserved 3 USDC and expired cancellation/refunds conserved 2 USDC. Current automated signer commands and protected-key handling are documented in docs/public-release.md.
