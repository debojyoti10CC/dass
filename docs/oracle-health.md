# Oracle health and settlement evidence

Run `npm run oracle:health` for a read-only check of the BTC/USD minute that ended roughly one minute ago. Use `npm run oracle:health -- --bucket <Unix-seconds>` to select an exact minute. This command loads no wallet, signs nothing, prints each source's price/error, and saves the exact source bytes and diagnostics to ignored `work/oracle-health.json`. Exit status 0 means healthy; 1 means blocked.

## Committed policy for new crypto markets

New BTC/USD markets prepared by `scripts/real-markets.mjs` commit `oracleHealth` inside their hashed rules. Version 1 uses Coinbase Exchange BTC-USD, Bitstamp BTC/USD, and Kraken XBT/USD. These are USD spot candles, not USDT proxies. Each must contain exactly one record for the same 60-second bucket. Retrieval must occur at least 120 seconds after bucket start and no later than 300 seconds after bucket end.

All three must pass. The exact integer test is `(maximum - minimum) * 10000 <= minimum * 100`, allowing at most 1% spread. An outage, timeout, malformed response, duplicate/missing bucket, stale retrieval, nonpositive price, or larger spread stops signing. There is no two-source fallback or majority vote in this version. The 1% threshold is an initial committed policy, not an empirically calibrated guarantee; tune it only for future markets after reviewing normal exchange spreads.

Coinbase remains the settlement value. Bitstamp and Kraken check its plausibility; the engine does not average prices or silently change the question. Settlement is still normalized through the deployed contract. If a healthy observation is never archived in the retrieval window, this policy cannot resolve; cancel after `resolveBy` for original-deposit refunds. A validated observation archived in time may be submitted later, before `resolveBy`.

`npm run resolve:testnet` checks rules and resolver identity, collects all three sources concurrently, and archives exact source bytes, SHA256 hashes, prices and retrieval times. It checks the resulting evidence before submitting. A blocked health report is saved under `work/<network>-<slug>-oracle-health.json`. Browser resolution of a market with `oracleHealth` is blocked; use the protected resolver command so these checks run.

## Cached evidence

Every run validates fresh or cached evidence against chain, contract, market ID, resolver, rules hash, source, observation policy, units, precision, rounding and normalization. It checks the source archive hash, independently selects the exact Coinbase candle, compares its raw value and original record, and recomputes the normalized outcome through the contract. For three-source markets it also re-parses every archived source and recomputes health, instead of trusting a saved `healthy` flag. Retrieval times must be admissible and cannot be in the future.

Cached successful observations are pinned: later source revisions do not replace them. A partial/missing archive fails closed. Existing markets with single-source rules keep their original policy; their caches get integrity and normalization validation, but they do not acquire a new three-source requirement.

## Trust and limits

This is an off-chain signing safeguard, not an on-chain oracle or multi-resolver consensus. The immutable resolver wallet can still bypass the script and call the contract directly. Three exchange responses reduce individual data failures but cannot guarantee truth, prove a retrieval timestamp, or prevent a malicious operator from fabricating a consistent archive. Requiring two of three independent resolver signatures needs a resolver contract, independent keys/operators, and newly created markets pointing to it; existing resolver addresses cannot be replaced.

The price engine supports BTC/USD minute candles. Football has separate committed result adapters; see [football-oracles.md](football-oracles.md) for provider credentials, fixture mappings and activation. Kraken exposes only the most recent 720 OHLC entries and includes an uncommitted current candle; the exact completed bucket and retrieval window prevent using that current entry as a substitute.

Official schemas: [Coinbase candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles), [Bitstamp OHLC](https://www.bitstamp.net/api/), [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data).

Run `npm run test:oracle` for source-health, archive-tampering, normalization, deadline, and no-signing integration tests. Tests mock source and signing boundaries and do not spend public funds.
