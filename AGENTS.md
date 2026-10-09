# AGENTS.md

How to run this app for a ZKsync governance signer, verify a proposal with it, and run its tests. Read the rules first.

## Rules

- Read-only on mainnet. Never sign, never send a transaction, never POST to the Safe Transaction Service. Signing is
  the signer's own action in their Safe; the app only reads.
- Report hashes and addresses in full. A signer compares them character by character with their hardware wallet.
- Never rely on Safe's API alone. A signature counts only when `status` is `"valid"`, which means the governance
  contract accepted it in an `eth_call`.
- Stop and report if `governance.warnings` is non-empty, `governance.network.overrides` is non-empty, or
  `logHistory.status` is not `"ok"`. These mean the contracts disagree, a trust anchor was replaced, or proposal lists
  may be incomplete. Also report `sync.cache.state` `"mismatch"`: the log history the RPC serves now differs from the
  one the app saved in its last run (a changed cache file, or an RPC with different history).

## Run

Needs Node.js 20+, plus an Ethereum mainnet or Sepolia RPC with log history. Use the signer's own
RPC, or `https://mainnet.gateway.tenderly.co` / `https://sepolia.gateway.tenderly.co`.

```bash
L1_RPC_URL=<rpc> npm start          # repo root: install, build, serve on http://localhost:3000
curl -s localhost:3000/api/status | jq '{ok, chain: .governance.network.label, warnings: .governance.warnings, overrides: .governance.network.overrides, logHistory, cache: .sync.cache.state}'
```

Pages start streaming at once and fill in as their reads finish; JSON waits for complete, current results. Measured
on mainnet (Infura RPC with a Safe API key, 2026-10-07, `apps/web/test/support/benchmark-sync.ts`; details in
`docs/performance-improvements.md`):

| When | JSON, complete | Page: first bytes / data / complete |
| --- | --- | --- |
| First request after the start | 0.7–6.5 s (`/api/emergency/<id>` slowest) | 25–31 ms / 0.2–2.8 s / 0.8–6.3 s |
| Running, also right after a new block | 1–32 ms | 4–21 ms / 5–21 ms / 6–246 ms |
| Safe copies older than 60 s (after a pause) | 3–40 ms, or 2.0–4.9 s where Safe is read again | 18–29 ms / 19–31 ms, older copies labelled / up to 5.9 s |

Rarely (once in 26 blocks measured) the sync engine (below) serves a new block at once, when it cannot rule out that
its clock ran behind the chain's; the first request at that block then verifies signature sets itself (0.5 s for an
upgrade's).

Without a Safe API key, Safe allows 2 requests/s and 5,000 a month per IP: the app then reads Safe only when a
request needs it, so the 16–17 member Safes an upgrade or emergency upgrade needs take about 9 s to read again once
their copies are older than 60 s.

At start the app reads the ProtocolUpgradeHandler's log history in the background (`PREWARM=0` turns this off).
`/api/status` shows its progress in `sync.index`: `state` goes from `idle` to `backfilling` to `ready`, or is
`unavailable` with an `error`. Lists wait a bounded time for it and fail rather than answer from part of the
history. `logHistory` is still the check that counts. The ZKsync Era governors' proposal events (created,
executed, canceled) are indexed the same way, in `sync.l2Index`, for the veto pages and startable upgrades.

While the app runs, a sync engine follows the chain head and at each new block refreshes what requests read (the
head, governance, upgrade states, the signature sets pages showed), so they find it in memory. It never answers by
itself: stopped or failing, requests read on demand with the same bounds (head 4 s, governance 30 s, Safe 60 s).
A new block is served to requests once what they read at it is in memory (signature sets included), at most 2 s
after the engine saw it; until then they read the block before. `sync.engine` shows it: `mode` (`always` by default,
`window`, `off`; `off` on anvil/hardhat), `active`, the `head` it follows (`servedAt`: when requests started to read
it), `lastTick` (`failedSteps`: steps that failed at that block), and `cost`: the JSON-RPC and Safe requests the app
sent in the last hour, with `mode` `viewing` (a request within `SYNC_KEEPWARM_MS`; reading `/api/status` does not
count) or `idle`. `sync.safe` is the background Safe sweep (`groups` kept under 60 s old, the quota-paced `baseline`
check of every member Safe, `budgetUsedThisHour`, `paused` and why), `sync.signatures` the sets it re-verifies at
each block. These are information; the checks are still `warnings`, `overrides`, `logHistory` and a
`sync.cache.state` of `"mismatch"` (see Rules).

Pages and JSON differ in one way. A page streams at once and may first show, always labelled, what the app already
holds: Safe copies older than 60 s ("Safe copies from 2m ago · refreshing"), a set's last verdict at an older block
("Verified at block #N · re-verifying at #M": nothing in a passing colour, nothing to sign or send from it), the
history the last run saved ("History from last run · re-verifying"), or an upgrade located directly while the
history is still read ("Located directly · history index verifying"). The current result replaces it in the same
response. `/api/*` never answers that way: only with Safe copies at most 60 s old, verdicts read at the current head
and this run's own history, as before. Every set carries `verifiedAtBlock` and `safeFetchedAt`; `stale` is always
`false` in JSON.

The app keeps a local cache of public chain and Safe data between runs, in
`apps/web/.cache/chain/<chainId>-<first 8 hex digits of the genesis hash>.json` (folder 0700, file 0600): both log
histories up to their finality boundary, timestamps of final blocks it read, and members' last Safe message listings
with the time Safe answered. Never verdicts, governance reads, settings, RPC URLs or API keys. At start the file is
checked against the chain id and genesis block, and the normal backfill re-reads the history: `sync.cache.state` is
`provisional` until then, `verified` when it matched, `mismatch` when it did not (the last run's data is then dropped
from memory and from the file, and the app uses what it read), `absent` without a usable file (`sync.cache.detail`
says why), `disabled` with `CHAIN_CACHE=0` or on anvil/hardhat. JSON never answers from it: `/api/*` waits for this
run's own reads exactly as without it. Pages may show it first, labelled "History from last run · re-verifying" (Safe
copies with their age), and this run's answer replaces it in the same response. To drop it, stop the app and delete
`apps/web/.cache/chain/`.

## Verify

Every page has a JSON twin. Both run the same code.

| What | Page | JSON |
| --- | --- | --- |
| Status, roles, thresholds | `/` | `GET /api/status` |
| Protocol upgrades | `/app/proposals` | `GET /api/upgrades` (`?history=all` for everything since deployment) |
| One upgrade | `/app/proposals/<id>` | `GET /api/upgrades/<id>` |
| Emergency upgrades | `/app/emergency/<id>` | `GET /api/emergency/<id>`; `POST` the payload JSON to the same URL to check it against the id |
| Freeze request | `/app/freeze/<soft-freeze\|hard-freeze\|unfreeze\|set-soft-freeze-threshold>?nonce=&validUntil=[&threshold=]` | same path under `/api/freeze/` |
| Guardian veto | `/app/l2-cancellations/<l2ProposalId>?governor=&l2GasLimit=&l2GasPerPubdataByteLimit=&refundRecipient=&txMintValue=&nonce=` | same path under `/api/vetoes/` |

Example: check upgrade `0x77d5…eaaa`. On mainnet today it is executed. The Security Council approved it in tx `0x1defa4f7…` with 6 of the 7 signatures in Safe.

```bash
ID=0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa
curl -s localhost:3000/api/upgrades/$ID | jq '{
  state: .stateLabel, idMatches: .started.idMatches, calls: .started.proposal.calls,
  sets: [.sets[] | {key, state: .state.status, threshold: .set.threshold, valid: (.set.valid|length),
          thresholdCheck: .set.thresholdCheck.status,
          members: [.set.members[] | {label, member, status, source}],
          used: [.used[]? | {signer, matchesSafe}], historical}]}'
```

What the fields mean:

- `started.idMatches`: `keccak256(abi.encode(calls, executor, salt))` equals the id. The calls are what will run.
- `sets[].set.typedData` / `.hashes.digest`: the exact EIP-712 data members sign. The domain is read from the
  contract's `eip712Domain()`.
- `sets[].set.members[].hashes`: per member Safe, the `domainHash` and `messageHash` a hardware wallet shows, and the
  `safeMessageHash` it signs (also Safe{Wallet}'s id for the message).
- `members[].status`:
  - `valid`: accepted by `checkSignatures` (or the Safe's `isValidSignature`).
  - `collecting`: the Safe has fewer owner signatures than its threshold.
  - `invalid`: rejected; `error` holds the revert.
  - `missing`: no signature.
  - `unavailable`: Safe's API failed. On-chain approvals are still checked.
- `set.thresholdCheck.status = "met"`: the contract accepted the whole sorted set at its on-chain threshold.
- `execution`: `to`, `data` and `value` to send, plus `simulation` (an `eth_call` on the latest block). Anyone can send it.
- For completed actions:
  - `used[].matchesSafe`: the signatures the transaction carried are byte-identical to Safe's copies.
  - `historical.accepted`: the contract accepts them at the block before execution (needs an archive RPC).

Emergency upgrades sign only the id. Before execution the calls and salt must come from the proposer:

```bash
curl -s -X POST localhost:3000/api/emergency/<id> -H 'content-type: application/json' -d @payload.json | jq '.check'
```

Payload format: `{"salt":"0x…","calls":[{"target":"0x…","value":"0","data":"0x…"}]}`. An `executor` field is
optional; if present it must be the Emergency Upgrade Board. Once executed, `GET` returns `executed.proposal`, rebuilt
from the execution calldata, with `idMatches`.

A signature held outside Safe can be checked by adding `?sig=<memberSafe>:<signatureHex>` (repeatable) to any page or
JSON URL. It is verified on-chain like the others and stored nowhere.

## Test

On Node 25+, which no longer bundles corepack, use `npx pnpm@9.7.1` where these say `corepack pnpm`.

```bash
corepack pnpm install
corepack pnpm check && corepack pnpm typecheck            # lint + types (all packages)
corepack pnpm test                                        # hermetic: web unit/server tests, CLI tests
cd apps/web && corepack pnpm test:i                       # mainnet, read-only: the brief's evidence (Tenderly + Safe API)
cd apps/web && corepack pnpm test:fork                    # write paths on an anvil fork (needs `anvil`; FORK_URL to override)
corepack pnpm --filter web build && cd packages/e2e && corepack pnpm test:web   # Playwright on the fork (PW_CHANNEL=chrome to use local Chrome)
cd apps/web && corepack pnpm exec tsx test/support/benchmark-sync.ts   # after the build: read-only timings and upstream cost (about 30 min)
```

Test data recorded from mainnet lives in `apps/web/test/fixtures` (re-record with
`apps/web/test/support/record-fixtures.ts`). The fork tests make a public anvil test key an owner of member Safes,
on the local fork only, and serve its signatures from a local mock of the Safe API (`apps/web/test/support`). The
Playwright suite opens the app as a Safe App in a local stand-in for Safe{Wallet}
(`packages/e2e/suites/web/safe-shell.ts`).

## Map

- `apps/web/app/.server/`: chain and Safe access, log scanning, the verification engine (`signatures.ts`), and one
  module per flow (`flows/`). `chain/` holds the read-only JSON-RPC lanes, the log indexes and the revert
  classification, `sync/` the engine, `safe/store.ts` the Safe listings, `persist/` the chain cache.
- `apps/web/app/common/`: shared with the browser: ABIs, EIP-712 types, Safe hashes, calldata builders, pinned
  network addresses (`networks.ts`).
- `apps/web/app/routes/`: pages (`app/…`) and the JSON API (`api+/…`).
- `apps/cli/`: upgrade verification CLI. Each upgrade page offers its upgrade file.
- `packages/e2e/`: Playwright suite for the web app (`suites/web`) and CLI e2e (`suites/cli`).
