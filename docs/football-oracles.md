# Football result sources

The existing football markets predict **total regulation-time goals**, not a winner or bookmaker odds. Previously they used trusted manual reporting from official Premier League pages. BTC price providers cannot settle football matches.

## Implemented providers

Three server-side result adapters are wired:

| Provider | Credential in ignored `.env` | Identity and full-time gate |
| --- | --- | --- |
| football-data.org v4 | `FOOTBALL_DATA_TOKEN` | Match/team/competition/season IDs, FINISHED + REGULAR, fullTime home/away |
| API-Football v3 (direct API-Sports endpoint) | `API_FOOTBALL_KEY` | Fixture/team/league/season IDs, FT, score.fulltime home/away |
| Sportmonks v3 | `SPORTMONKS_TOKEN` | Fixture/participant/league/season IDs, FT, CURRENT scores |

This implementation is for regulation-time league football. Extra time, penalty shootouts, awarded results and all non-final statuses are rejected. Keys are sent in request headers, never query parameters, browser variables, or evidence. Provider access, competition/season coverage, response schemas and rate limits must be tested with the actual account plans before creating markets. Adapters are tested against documented schema fixtures; paid live accounts have not been connected.

## Activate locally

1. Obtain provider accounts with coverage of the intended competition and season. No subscription or paid plan is purchased by these scripts.
2. Add the three credentials to ignored `.env` using `.env.example` as the variable reference. Do not paste keys into chat or put them in `VITE_*` variables.
3. Copy `config/football-oracles.example.json` to ignored `work/football-oracles.json`. Replace placeholders with real provider IDs for the **same fixture**: fixture ID, home and away team IDs, competition ID, and season ID. API-Football's season is the year; other providers use their own season IDs. Cross-check team orientation and the scheduled UTC kickoff on all three providers. Do not guess IDs or reuse one provider's IDs for another.
4. Run `npm run oracle:football` for credential-presence and mapping validation. This does not load a wallet or prove an account is authorized.
5. Run `npm run oracle:football -- --fixture <slug>` for a real result-health check. Before full time it is expected to be blocked. Select a completed fixture with a mapped kickoff inside the last 48 hours for a live smoke test. Reports go to ignored `work/football-oracle-health.json`; exit 1 means unconfigured or blocked.

A different mapping file may be provided with `--config <path>`. Never put credentials in that JSON; fixture IDs and source URLs are committed public information.

## Market preparation and resolution

When preparing a new catalog, `scripts/real-markets.mjs` now requires all provider credentials and exact football mappings for its fixture slugs. It commits the three-provider policy into each new football market's rules before funding. It does not change existing catalog records or deployed rules. Presence checks do not prove coverage: perform the provider account/fixture verification first.

All three providers must agree **exactly** on home score, away score and actual kickoff, not merely total goals. Total goals must be 0–30; 0–0 is valid. There is no majority fallback. Wrong fixtures, reversed teams, wrong competitions/seasons, null scores, duplicate rows, live/abandoned/cancelled/postponed statuses, outages, and score disagreement stop signing. Fresh snapshots must be no more than five minutes old, inside the resolution window, and retrieved after at least 90 minutes from actual kickoff.

If a postponed fixture later completes, its actual kickoff must be at or after `closeAt`, all providers must agree on it, and its admissible observations must arrive before `resolveBy`. Otherwise wait or cancel at expiry for original-deposit refunds.

For an authorized resolver and a **new market with committed football oracle rules**:

```sh
npm run resolve:football -- --network arc-testnet --market <market-id>
```

Unlike the diagnostic command, this command signs and sends a public transaction. It uses the existing protected operator signer and release gates. No transactions were sent during setup.

The resolver archives exact response bytes, SHA256 hashes, retrieval timestamps and parsed results inside canonical evidence JSON. On retries it re-parses every archived source, checks market/rules/resolver identity and rule semantics, then recomputes the normalized outcome through the deployed contract. A saved health flag or supplied outcome is never trusted. Previously valid archived full-time consensus stays pinned; later source revisions do not replace it. Missing/corrupted archives block signing. Resolved markets are checked against the committed evidence hash without sending again.

Browser resolution is blocked for markets with an oracle policy; the protected resolver path runs the archive checks. Existing official-page football markets cannot be silently switched to this engine and retain their manual official-source settlement policy.

## Checks and remaining trust

`npm run test:oracle` runs football and crypto regression tests, including zero-score draws, false fixture IDs, wrong leagues/seasons, non-final statuses, same-total/different-score disagreement, reschedules, stale/future data, cached evidence tampering, deadline enforcement and no-signing failure paths.

These are three distinct data vendors, not three on-chain resolver signatures. Vendor feeds may share upstream information; the engine cannot guarantee truth or defeat a malicious signer that bypasses it. No automated score-to-probability forecasting model is added. The current prediction curve remains a sponsor/user forecast, and all settlement is driven by the final verified numeric result.

Official schemas: [football-data match](https://docs.football-data.org/general/v4/match.html), [API-Football v3](https://www.api-football.com/documentation-v3), [Sportmonks scores](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/scores), [Sportmonks states](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/states), [Sportmonks authentication](https://docs.sportmonks.com/v3/welcome/authentication).
