# Web app

Run it with the one command in the [root README](../../README.md). This page is for working on it.

## How it works

There is no database. Everything is derived from the chain and Safe (with in-memory caches, and a local cache of public
chain data kept between runs):

- **Roles and rules come from the chain.** The ProtocolUpgradeHandler address is pinned per network in
  `app/common/networks.ts`. The Security Council, Guardians, Emergency Upgrade Board, members, thresholds, nonces and
  EIP-712 domains are read from it through `L1_RPC_URL`.
- **Proposals:**
  - Standard upgrades come from `UpgradeStarted` logs, each id re-hashed from its content.
  - Freeze requests, vetoes and emergency ids come from members' Safe messages (Safe Transaction Service).
  - Emergency calls and salt come from a payload checked against the id in the browser. After execution they are
    rebuilt from the calldata.
- **Signatures:** for each member Safe the app computes the SafeMessage hash itself and looks it up in Safe. It also
  checks the Safe's on-chain `signedMessages` and any `?sig=` supplied in the URL. A signature counts only if the
  consuming contract accepts it in an `eth_call` (`app/.server/signatures.ts`).
- **Signing** goes from the browser to the member's Safe over WalletConnect. Nothing is posted to this server.

Log scans split ranges the RPC refuses, learn its limit, and cache everything below the safe head (or below the fork
block on anvil). A canary log flags RPCs that silently return no history.

**Sync** (`app/.server/sync/`): the app follows the chain only while one of its pages is open and visible in a
browser (`components/presence.tsx` beats to `/resources/presence` every 10 s with the keys of what it shows;
`sync/presence.ts`). Then the engine follows the head and, at each new block, re-reads what is on screen at that
block, normally in one Multicall3 call (`sync/snapshot.ts`, `chain/aggregate.ts`, `chain/verdicts.ts`); the Safe
watcher (`safe/store.ts`) checks the member Safes of open sets on screen; ZKsync Era has a minute timer while an Era
page is on screen (`sync/era.ts`); and an open page reloads its data from memory when what it shows changed
(`sync/revs.ts`). With no page open nothing is sent upstream; `/api/*` reads on demand and never counts as use.

**Chain cache** (`app/.server/persist/chain-cache.ts`): the log histories (ProtocolUpgradeHandler, Era governors) up
to their finality boundary, final block timestamps and members' last Safe listings are saved to
`.cache/chain/<chainId>-<genesis hash prefix>.json` (atomic write, 0600; at most once a minute when something changed,
and on shutdown). At start the file is checked against the chain and seeded as provisional; the backfill re-reads the
history and the two must match (else the file is discarded). A saved block timestamp is checked when that block is
read again; saved Safe listings are shown with their age until the Safe is read again. Only pages read provisional
data, labelled; `/api/*` never does. `CHAIN_CACHE=0` turns it off; dev nodes never use it. Delete `.cache/chain/` to clear it.

## Develop

```bash
L1_RPC_URL=https://mainnet.gateway.tenderly.co corepack pnpm dev   # vite dev server on :3000
corepack pnpm typecheck && corepack pnpm test                      # unit (jsdom) + server tests
corepack pnpm test:i      # mainnet read-only evidence
corepack pnpm test:fork   # write paths on an anvil fork
```

Test layout: `test/unit` (components), `test/server` (pure logic, offline, on recorded mainnet data),
`test/integration` (mainnet, read-only), `test/fork` (anvil fork + mock Safe API), and `test/support`, which is
shared with the Playwright suite in `packages/e2e`.

## Environment

Only `L1_RPC_URL` is required. The optional variables are listed in the root README. `LOG_LEVEL`, `SERVER_PORT`
(default 3000) and `ALLOW_INDEXING` (default false) behave as before. `SERVER_HOST` defaults to `127.0.0.1`, so a
local run (which spends your RPC) answers only your machine; the Docker image sets `0.0.0.0`. After it starts
listening (and after a settings change) the server warms its caches in the background: network, governance, the
log-history canary, the ProtocolUpgradeHandler log index, then the governance Safes' message listings, one at a
time. `PREWARM=0` turns that off.
