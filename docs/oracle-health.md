# Oracle health and settlement evidence

New BTC/USD markets use **one Chainlink BTC/USD feed**. No Coinbase, Bitstamp or Kraken calls or API keys are needed for their price or settlement. Football keeps its separate provider policy.

`config/chainlink-feeds.json` contains the feed's source chain ID, address, decimals and maximum age. The Arc mainnet BTC/USD proxy and its 8 decimals / 86400-second heartbeat were checked against the [official Chainlink directory](https://docs.chain.link/data-feeds/price-feeds/addresses?network=arc).

For **Arc testnet settlement**, the configured source is the live **Arc mainnet** feed (source chain `5042`, settlement chain `5042002`). The protected resolver reads mainnet through its public RPC and sends settlement only to testnet. Rules explicitly commit both chains; source archives identify mainnet and settlement evidence identifies testnet. This does not deploy or claim a native testnet feed, and it is not a cryptographically verified cross-chain relay. A native Arc testnet BTC/USD proxy was not available in the official directory. No mocks, copied addresses on the wrong chain, exchange fallback or mainnet transactions are used.

For Arc mainnet markets, source and settlement both use chain `5042`. The normal mainnet release gates still apply to market deployment and signing; read-only mainnet price access does not require a mainnet deployment or signer.

Run `npm run oracle:health -- --network arc-testnet` (or `arc-mainnet`) for a read-only feed check. This loads no wallet and sends no transactions. Reports go to ignored `work/oracle-health.json`; exit 1 means blocked. Existing exchange-market diagnostics remain available with `npm run oracle:health -- --bucket <Unix-seconds>`.

Settlement uses `latestRoundData` at the **first source-chain block at or after the committed observationAt**, found by timestamp search. The predecessor must be earlier. The price is the feed value available at that time, not an exchange candle or necessarily a price freshly published at that exact second. The configured maximum age is currently 24 hours, matching the published heartbeat; an older value, nonpositive price, incomplete round, future update, incorrect pair/decimals or wrong chain blocks signing. Use a different age limit only in future market rules, understanding that a tighter limit can prevent settlement during quiet markets.

The protected resolver archives the feed identity, all round fields and block number/hash/timestamp, recomputes normalization, and re-reads the same historical state before every signing attempt. RPC access must support historical `eth_call` and block lookup. Missing history or changed block/round data blocks settlement; no exchange fallback or later-price substitution is allowed. An unresolved market retains its permissionless expiry refunds. The existing `npm run resolve:testnet` command selects Chainlink or legacy Coinbase behavior from the committed rules; its legacy script filename is retained for compatibility.

This is still a **trusted resolver wallet**. Chainlink provides the decentralized price, but the market contract does not enforce feed reads and its resolver can bypass the script. Onchain enforcement requires a separately deployed resolver contract and new markets naming that contract. Existing deployed markets and their immutable rules are not migrated.

## Live browser-signed testnet E2E

`npm run test:public:chainlink -- --check` verifies the live source, chain IDs and the funded browser operator without sending transactions. `npm run test:public:chainlink` serves a session-protected signing page at `http://127.0.0.1:8791`. Connect the configured Core wallet and approve each testnet transaction. Keys remain inside the wallet; the loopback server only prepares requests and records public transaction hashes. The runner checks signer, chain, nonce, calldata, destination and receipt before advancing, and journals requests before prompting so ambiguous outcomes cannot create a duplicate deployment.

The runner deploys a separate contract with browser wallet `0x7e8279CFE2c20C37EaD44a80517FdBb430ACA047` as its immutable operator, creates one market with 1 test USDC backing, places one 1 test USDC trade from that same wallet, waits for the committed future observation, validates and resolves from live mainnet Chainlink state, then claims both payouts. It verifies rejected late trading, full deposit/payout conservation and zero remaining liability. Each transaction is capped at 1 test USDC of estimated maximum gas. This is a single-wallet lifecycle test; the earlier separate-trader-wallet acceptance remains independent.

Results are saved separately in `deployments/arc-testnet-browser-chainlink-e2e.json` and `deployments/arc-testnet-browser-chainlink-resolution.json`, with source archives under `web/public/evidence`. This test does not replace the existing app deployment or its historical release evidence.

## Legacy committed exchange policy

Previously prepared BTC/USD markets retain `oracleHealth` inside their hashed rules. Version 1 uses Coinbase Exchange BTC-USD, Bitstamp BTC/USD, and Kraken XBT/USD. These are USD spot candles, not USDT proxies. Each must contain exactly one record for the same 60-second bucket. Retrieval must occur at least 120 seconds after bucket start and no later than 300 seconds after bucket end.

All three must pass. The exact integer test is `(maximum - minimum) * 10000 <= minimum * 100`, allowing at most 1% spread. An outage, timeout, malformed response, duplicate/missing bucket, stale retrieval, nonpositive price, or larger spread stops signing. There is no two-source fallback or majority vote in this version. The 1% threshold is an initial committed policy, not an empirically calibrated guarantee; tune it only for future markets after reviewing normal exchange spreads.

Coinbase remains the settlement value. Bitstamp and Kraken check its plausibility; the engine does not average prices or silently change the question. Settlement is still normalized through the deployed contract. If a healthy observation is never archived in the retrieval window, this policy cannot resolve; cancel after `resolveBy` for original-deposit refunds. A validated observation archived in time may be submitted later, before `resolveBy`.

`npm run resolve:testnet` checks rules and resolver identity, collects all three sources concurrently, and archives exact source bytes, SHA256 hashes, prices and retrieval times. It checks the resulting evidence before submitting. A blocked health report is saved under `work/<network>-<slug>-oracle-health.json`. Browser resolution of a market with `oracleHealth` is blocked; use the protected resolver command so these checks run.

## Cached evidence

Every run validates fresh or cached evidence against chain, contract, market ID, resolver, rules hash, source, observation policy, units, precision, rounding and normalization. It checks the source archive hash, independently selects the exact Coinbase candle, compares its raw value and original record, and recomputes the normalized outcome through the contract. For three-source markets it also re-parses every archived source and recomputes health, instead of trusting a saved `healthy` flag. Retrieval times must be admissible and cannot be in the future.

Cached successful observations are pinned: later source revisions do not replace them. A partial/missing archive fails closed. Existing markets with single-source rules keep their original policy; their caches get integrity and normalization validation, but they do not acquire a new three-source requirement.

## Trust and limits

This is an off-chain signing safeguard, not an on-chain oracle or multi-resolver consensus. The immutable resolver wallet can still bypass the script and call the contract directly. Three exchange responses reduce individual data failures but cannot guarantee truth, prove a retrieval timestamp, or prevent a malicious operator from fabricating a consistent archive. Requiring two of three independent resolver signatures needs a resolver contract, independent keys/operators, and newly created markets pointing to it; existing resolver addresses cannot be replaced.

The legacy exchange engine supports BTC/USD minute candles. Football has separate committed result adapters; see [football-oracles.md](football-oracles.md) for provider credentials, fixture mappings and activation. Kraken exposes only the most recent 720 OHLC entries and includes an uncommitted current candle; the exact completed bucket and retrieval window prevent using that current entry as a substitute.

Official schemas: [Coinbase candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles), [Bitstamp OHLC](https://www.bitstamp.net/api/), [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data).

Run `npm run test:oracle` for source-health, archive-tampering, normalization, deadline, and no-signing integration tests. Tests mock source and signing boundaries and do not spend public funds.
