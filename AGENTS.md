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
on mainnet (Infura RPC with a Safe API key, 2026-10-08, `apps/web/test/support/benchmark-sync.ts`; details in
`docs/performance-improvements.md`):

| When | JSON, complete | Page: first bytes / data / complete |
| --- | --- | --- |
| First request after the start (measured 2026-10-07, before the app followed the chain only while in use) | 0.7–6.5 s (`/api/emergency/<id>` slowest) | 25–31 ms / 0.2–2.8 s / 0.8–6.3 s |
| A page open, also right after a new block | status and lists 1–33 ms; details 3–20 ms, or 0.2–4.8 s where Safe is read again (below) | 5–13 ms / 7–17 ms / 7–198 ms, up to 3.9 s where Safe is read again |
| After a pause: no page open for 90 s, 10 minutes or 1 hour | status and lists 0.4–0.65 s | 14–40 ms / with the first bytes as last shown (labelled), current after 0.4–0.5 s / 0.6–5.8 s; a page not shown since the start: data after 0.4–0.5 s |

With no page open the app reads nothing ahead of requests, so the first request after a pause reads the head and
what it needs at that block itself: about half a second. A page shown before in this run sends, with its first
bytes, what it last showed, labelled "As of block #N · reading the newest block" (in no colour, nothing to sign or
send from it), and the current data replaces it in the same response once those reads are done; a page not shown
since the app started sends its frame at once and its data after those reads. The pages opened right after it find
that head and have their data at once.

JSON reads Safe again whenever the copies it needs are older than 60 s, also while a page is open (the app keeps
checking only the Safes of sets that can still be signed): a detail request then takes 0.2–4.8 s with a Safe API key,
about 4–5 s when all 16–17 member Safes of an upgrade or emergency upgrade are read again. Without a key Safe allows 2
requests/s and 5,000 a month per IP, and those reads take about 9 s.

At start the app reads the ProtocolUpgradeHandler's log history in the background (`PREWARM=0` turns this off).
`/api/status` shows its progress in `sync.index`: `state` goes from `idle` to `backfilling` to `ready`, or is
`unavailable` with an `error`. Lists wait a bounded time for it and fail rather than answer from part of the
history. `logHistory` is still the check that counts. The ZKsync Era governors' proposal events (created,
executed, canceled) are indexed the same way, in `sync.l2Index`, for the veto pages and startable upgrades. This
warm-up runs once; it does not start following the chain.

The app follows the chain only while someone uses it: while a page of it is open and visible in a browser on this
machine (the tab tells the server so every 10 s; `SYNC_MODE=window`, the default). Nobody using it, it sends nothing
upstream at all, neither RPC nor Safe requests. `/api/*` and `/api/status` never count as use: JSON reads on demand,
so in a session that only reads JSON, like the commands below, `sync.engine.active` stays `false` and nothing is sent
between requests. While a page is visible, a sync engine follows the head and at each new block re-reads what is on
screen at that block, in as few requests as it can (normally one Multicall3 call with governance's values that
change, the upgrade states and the signature checks of the sets on screen), so pages answer from memory and an open
page reloads its data by itself when what it shows changed. Four things are not read at every block: governance's
values that never change (members, EIP-712 domains, constants), kept in memory while the Security Council's,
Guardians' and Emergency Upgrade Board's code matches the code pinned for the network; a member Safe's info
(owners, threshold), at most 5 minutes old and read again in that call before it expires (it never decides whether
a signature is valid); an upgrade read as executed or expired at a final block (it cannot change); and what comes
from ZKsync Era, read once a minute while a page that shows it is on screen. It never answers by itself: stopped or failing, requests read on demand with the same bounds (head 4 s, governance 30 s,
Safe 60 s). A new block is served to requests once what they read at it is in memory, at most 2 s after the engine
saw it; until then they read the block before.

`/api/status` reports this, for information (the checks are still `warnings`, `overrides`, `logHistory` and a
`sync.cache.state` of `"mismatch"`, see Rules):

- `sync.presence`: `inUse`, `reason` (`tab` or `page-load`), `tabs`, and `keys` (items on screen).
- `sync.engine`: `mode` (`window` by default, `always`, `off`; `off` on anvil/hardhat), `active` (following the head
  now), the `head` it follows (`servedAt`: when requests started to read it), `lastTick` (`failedSteps`: steps that
  failed at that block), `cost` (the JSON-RPC and Safe requests the app sent in the last hour;
  `infuraCreditsPerHour` is an estimate at Infura's credit weights; `mode` is `viewing` or `idle`; `pacer` is the
  follower's own pace, at most `SYNC_CREDITS_PER_SECOND`), and `clock` (how it polls for the next block, polls per
  block, how long after it saw a block it served it).
- `sync.snapshot`: the last per-block read (its block, what was unknown there).
- `sync.signatures`: the sets on screen the engine verifies at each block (`onScreen`, `open`, `perBlock`,
  `lastRecompute`).
- `sync.safe`: the Safe watcher (`watched`: Safes and cadences; `budgetUsedThisHour`; `paused` and why).
- `sync.l2`: the ZKsync Era timer (a head read and an index tail a minute while an Era page is on screen).

Pages and JSON differ in one way. A page streams at once and may first show, always labelled, what the app already
holds: after a pause, what it last showed ("As of block #N · reading the newest block"), Safe copies older than the
page allows ("Safe copies from 2m ago · refreshing"), a set's last verdict at an older block ("Verified at block #N ·
re-verifying at #M"), the history the last run saved ("History from last run · re-verifying"), or an upgrade located
directly while the history is still read ("Located directly · history index verifying"); nothing of it in a passing
colour, nothing to sign or send from it. The current result replaces it in the same response. That current result
is verified at the head like JSON's, but its Safe copies follow the page rule, not the 60 s one: while a set that can
still be signed is on screen, the member Safes whose signature is not valid yet are checked every 60 s (stretched
when Safe's quota is low; every 5 minutes without a Safe API key), and the page uses those copies for as long as
that cadence, labelled with their age ("Safe checked 20s ago · next check in 40s"); copies of valid members and of
sets that cannot be signed any more are used whatever their age, also labelled. A Safe copy only supplies
candidates: whether a signature is valid is decided on-chain at the head either way. **Fetch signatures** on the set
asks Safe at once and checks the set again, and lists fed by Safe have **Check Safe now**. `/api/*` never answers
that way: only with Safe copies at most 60 s old, verdicts read at the current head and this run's own history, as
before. Every set carries `verifiedAtBlock` and `safeFetchedAt`; `stale` is always `false` in JSON.

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
cd apps/web && PW_CHANNEL=chrome corepack pnpm exec tsx test/support/benchmark-sync.ts   # after the build: read-only upstream cost and timings (about 85 min; --only=… for some)
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
