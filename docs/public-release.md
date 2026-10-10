# Public testnet and mainnet release

## Current deployment

- Arc Testnet, chain 5042002, RPC `https://rpc.testnet.arc.io`.
- Actual contract `0xc613bca497257cfec8d1754e1d81136cb9862ca8`, transaction `0x24543eb7f6d6a605693227bd4c3e31e44b9c2550ca83d07a329f59f08e50c5bc`, block 66385566. Explorer source verification passed.
- Operator/resolver `0x8c22625D7f7fd74590F0c57956C2A229E3D2AcBC` uses a separately generated protected signer. Trader wallets are distinct actual public accounts. Disposable localhost keys are not used publicly.
- Only `DistributionMarkets` needs deployment. GaussianMath is internal and compiled into it; OpenZeppelin and PRBMath code is compiled into the same deployment. Test mocks, harnesses and deployment scripts are not application contracts to publish.
- Exact actual records and hashes are in the manifests and acceptance evidence. Embedded immutable rules identify the official source, field, timing, normalization and missing-data policy. Source hashes alone do not make the resolver trustless.

## Use the app

Run `npm ci`, then `npm run dev`. Connect your EVM wallet and switch/add Arc Testnet. The Circle faucet supplies test USDC for fees and collateral. Forecast changes require an exact approval, fresh review, wallet signing and a successful receipt. Reload recovers positions from chain records. Mainnet will use actual USDC and a separate manifest.

```powershell
node scripts/real-markets.mjs --network arc-testnet
node scripts/testnet-acceptance.mjs
# Only after the market's actual earliest retrieval time:
node scripts/resolve-coinbase.mjs --network arc-testnet
node scripts/testnet-acceptance.mjs --settle
node test/public-browser.mjs
```

Scripts reconcile existing hashes and never replace an unknown deployment or trade automatically. Signing material is Windows CurrentUser DPAPI encrypted under `.private/`, which is Git-ignored and never copied into the web build. Keep that encrypted folder and the Windows credential backup; source ZIPs do not contain it. Never paste keys in chat or into browser source.

## Mainnet sequence

The [Arc Microgrants page](https://dorahacks.io/hackathon/arc-microgrants/detail) requires a working mainnet deployment, public repository and accessible live link. It excludes testnet-only builds. Deadline: October 14, 2026 at 23:59 ET; the displayed local deadline is October 15 in Asia/Calcutta. Program dates can change.

1. Public testnet observation/resolution/claims and expired cancellation/refunds are complete: 3 USDC paid and 2 USDC refunded with exact conservation. Reviewed numerical/runtime/fuzz/static findings and production browser evidence are bound to source and evidence fingerprints by `deployments/mainnet-release-gate.json`. No independent audit is claimed.
2. Fund the dedicated operator `0x8c22625D7f7fd74590F0c57956C2A229E3D2AcBC` with **5 USDC on Arc Mainnet, chain 5042**. Testnet USDC cannot fund mainnet. Three markets lock 3 USDC in sponsor backing; current deployment/creation/approval estimates total about 0.311 USDC with headroom. The initial budget is approximately 3.311 USDC; trader deposits and subsequent settlement fees are separate. Each script caps a transaction’s maximum fee at 1 USDC. Exact current read-only estimates are in `deployments/arc-mainnet-funding-evidence.json`.
3. Run `node scripts/release-gate.mjs` to validate the recorded prerequisites, then `node scripts/deploy-public.mjs --network arc-mainnet` for a dry-run estimate. A dry run does not switch the frontend away from its testnet deployment. Broadcast with `--broadcast` after funding; verify with `node scripts/verify-public.mjs --network arc-mainnet`.
4. Create mainnet real markets with `node scripts/real-markets.mjs --network arc-mainnet`. It takes a fresh real ticker snapshot and future observation; no past testnet market is silently relabelled as live mainnet.
5. Set `DASS_DEPLOYMENT=arc-mainnet` before compiling/building. Publish the built frontend, verify public access and actual wallet transactions, and update public source/evidence. The currently connected GitHub account has `push: false` for `wolf1276/dass`, so repository access must be corrected before pushing changes there.
6. The builder submits the project and their own description/profile through DoraHacks. This work does not submit an application or accept program terms on their behalf.

## Hosted review deployment

The compiled application is live at [distribution-markets-arc-dass](https://distribution-markets-arc-dass.ddmpersonalworkspace.chatgpt.site) with **owner-private** access, using the actual public testnet contract. Hosting IDs, successful deployment and source commit are recorded in `deployments/arc-testnet-hosting-evidence.json`; this commit belongs to the separate static hosting checkout, not wolf1276/dass. Grant submission still needs a public mainnet live link.
