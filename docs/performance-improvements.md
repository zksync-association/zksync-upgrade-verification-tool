# Performance improvements

## October 6: answers kept ahead of requests, pages that never wait

Before this work every request read what it needed from the RPC and Safe itself. The full upgrade and
emergency lists scanned the ProtocolUpgradeHandler's history from its deployment in 10,000-block `eth_getLogs`
chunks inside the request (127–142 s on a fresh process). The message listings of the 16–17 member Safes were read
again, 220 ms apart, whenever they were older than 60 s. The head, governance and verdicts expired under the caller,
who then waited for them. Now the history is read once and indexed, a sync engine refreshes what requests read
before they ask, pages stream at once and say how old anything they show first is, and public chain data is kept
between runs. What counts as a valid signature is unchanged: the governance contract must accept it in an
`eth_call` at the current head.

### Before and after

Read-only, on mainnet, with the same Infura RPC (10,000-block `eth_getLogs` cap), Safe API key and machine.
"Before" is the app as it was before this work, measured on October 6 with one fresh server per endpoint (curl with a
browser user agent). "After" is `apps/web/test/support/benchmark-sync.ts` on October 7. One run each: these are
observations, not guarantees.

JSON, the complete answer to the first request of a fresh process:

| Endpoint | Before | After, no cache | After, with the chain cache |
| --- | ---: | ---: | ---: |
| `/api/status` | 857 ms | 786 ms | 692 ms |
| `/api/upgrades` | 4,467 ms | 1,078 ms | 896 ms |
| `/api/upgrades?history=all` | 142,207 ms | 2,805 ms | 3,939 ms |
| `/api/upgrades/0x77d5…` | 6,781 ms | 4,626 ms | 4,618 ms |
| `/api/emergency` | 126,999 ms | 5,208 ms | 4,761 ms |
| `/api/emergency/0xb166…` | 6,072 ms | 6,467 ms | 5,364 ms |
| `/api/vetoes` | 5,760 ms | 2,907 ms | 2,492 ms |
| `/api/freeze` | 2,936 ms | 2,916 ms | 2,974 ms |

A fresh process's JSON is still bounded by what it must read itself: the handler's history (2–3 s with this
provider) and the listings of the member Safes it shows (16–17 Safes at Safe's request rate, about 3.5 s). JSON
never answers from the chain cache, so with it JSON makes the same reads; the differences between those two columns
are run-to-run variation.

JSON in a running app. Warm: every path read once before. New block: the request sent the moment the engine served
a new head (requests read at it from then on), each path at its own block; for the two detail endpoints, the slowest
of that request and of six more, each at its own block, sent 0, 0.25, 0.5, 0.75, 1 and 1.5 s after the engine saw
the head (before and after it served it, 0.6–0.9 s after it saw it). Safe > 60 s: no request to the server for 70 s
and no background Safe reads (`SYNC_SAFE_HOURLY_BUDGET=0`, as without a key). Idle: no request for 70 s with
`SYNC_KEEPWARM_MS=5000`, so the engine had gone idle. "Before, Safe > 60 s" was measured once after a 95 s pause, one
endpoint after another, so later ones reused the listings the first one read; "after" waited 70 s before each
endpoint.

| Endpoint | Before, warm | After, warm | After, new block | Before, Safe > 60 s | After, Safe > 60 s | After, idle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/api/status` | 4 ms | 2 ms | 3 ms | – | 4 ms | 3 ms |
| `/api/upgrades` | 353 ms | 2 ms | 3 ms | 675 ms | 4 ms | 6 ms |
| `/api/upgrades?history=all` | 387 ms | 32 ms | 25 ms | – | 40 ms | 31 ms |
| `/api/upgrades/0x77d5…` | 447 ms | 3 ms | 13 ms (544 ms at one block, below) | 4,389 ms | 3,993 ms | 4,042 ms |
| `/api/emergency` | 163 ms | 3 ms | 6 ms | 781 ms | 4,327 ms | 4,316 ms |
| `/api/emergency/0xb166…` | 357 ms | 3 ms | 25 ms | – | 4,937 ms | 4,833 ms |
| `/api/vetoes` | 2,731 ms | 2 ms | 4 ms | – | 1,956 ms | 1,951 ms |
| `/api/freeze` | 4 ms | 1 ms | 2 ms | – | 2,159 ms | 2,373 ms |

A new block costs a running app's JSON nothing in the usual case: the engine serves a new head only once what
requests read at it is in memory, the signature sets pages watch verified at it included (at most 2 s after it saw
it); until then requests read the block before. The detail endpoints answered in 4–25 ms whenever they were asked,
from the moment the head was seen to 1.5 s after. (Before this was fixed on October 7 the engine served the head
before re-verifying the sets, and for about half a second of every block the detail endpoints took 0.3–0.5 s.) One
exception: when the previous head was confirmed by the local clock and nothing shows the new one arrived after its
slot began, the engine serves the new head at once (the clock may have run behind the chain's), and the first
request at it verifies the sets itself. That happened at one block of the 26 in this run: `/api/upgrades/0x77d5…`
then took 544 ms.

JSON still reads Safe again when its copies are older than 60 s and waits for it, by design: it never answers from
an older copy. With a key and someone using the app, the background sweep keeps the copies of the signer groups in
use under 60 s, so this case is the first request after a pause (or every request without a key).

Pages: when the first bytes, the page's main section, its main data (labelled if it is older) and the last byte
(every current result streamed) arrive. Before this work the shell itself waited for governance (1.1–1.5 s on a cold
server, measured October 5), and on a fresh process `/` completed in 5,268 ms, the upgrade page in 6,579 ms and
`/app/emergency` in 5,588 ms.

Each cell: first bytes · main section · main data · complete, in ms (same conditions as above; new block: the
request sent the moment the engine served a new head):

| Page | Fresh, no cache | Fresh, with cache | Warm | New block | Safe > 60 s | Idle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 27 · 28 · 1,214 · 5,310 | 26 · 27 · 340 · 6,338 | 7 · 7 · 7 · 9 | 21 · 21 · 21 · 152 | 26 · 26 · 26 · 4,448 | 24 · 24 · 25 · 4,709 |
| `/app/proposals` | 28 · 30 · 1,197 · 1,198 | 31 · 31 · 374 · 774 | 4 · 4 · 5 · 6 | 13 · 13 · 16 · 16 | 18 · 21 · 22 · 23 | 18 · 18 · 20 · 21 |
| `/app/proposals/0x77d5…` | 28 · 30 · 2,273 · 4,680 | 26 · 28 · 669 · 4,361 | 10 · 10 · 12 · 19 | 16 · 16 · 20 · 30 | 29 · 29 · 31 · 4,343 | 28 · 29 · 31 · 3,849 |
| `/app/emergency` | 25 · 27 · 834 · 5,186 | 25 · 26 · 245 · 5,189 | 6 · 6 · 7 · 7 | 13 · 13 · 14 · 246 | 20 · 21 · 22 · 4,798 | 20 · 21 · 22 · 4,729 |
| `/app/emergency/0xb166…` | 26 · 26 · 2,354 · 5,522 | 31 · 32 · 628 · 5,403 | 7 · 8 · 13 · 15 | 14 · 14 · 21 · 23 | 24 · 24 · 26 · 4,580 | 22 · 23 · 25 · 5,911 |
| `/app/l2-cancellations` | 28 · 29 · 2,783 · 2,784 | 25 · 25 · 757 · 2,665 | 5 · 5 · 5 · 6 | 9 · 9 · 9 · 11 | 20 · 21 · 21 · 1,890 | 19 · 19 · 19 · 1,923 |

The signature sets (the Security Council's, first) appeared on the upgrade page at 4,677 / 1,400 / 13 / 22 / 33 /
33 ms in these conditions, and on the emergency upgrade page at 5,520 / 2,999 / 8 / 16 / 175 / 304 ms. The
emergency list's pending section (ids signed in Safe) appeared at 5,185 / 938 / 7 / 243 / 149 / 157 ms.

On a fresh process every page starts within about 30 ms and shows its main section at once; its data follows as it
is read. While the app runs, every endpoint answers in 1–32 ms (apart from the one block above) and every page sends
its first bytes within 4–21 ms, also right after a new block. After a new block the emergency list's pending section (and `/`, which shows it)
streams within about 0.25 s: it reads, at the new head, the state of each emergency id members signed in Safe that
the log index does not know (one never executed), which the engine does not read ahead. With Safe copies older than
60 s, or after the engine went idle, pages show everything, signature sets included, within 20–410 ms, labelled with
the copies' age and the block of each verdict; the pages that read Safe complete in 1.9–5.9 s once it has been read
again, the same reads JSON waits for. In those two conditions the emergency list's first bytes took 91–96 ms before
October 7 (above the 50 ms aimed for) and 20 ms now: reading a Safe listing again with unchanged messages used to
replace their objects, so the page parsed and hashed all 17 listings' messages again (about 0.1 s) before its first
bytes; the Safe store now keeps the objects of messages that did not change, and the warm-up parses the listings it
holds at the start.

With the chain cache every page shows its data within 245–757 ms, labelled "History from last run · re-verifying"
(the signature sets and counts from Safe with their copies' age), and this run's verified answer replaces it in the
same response. That misses the 300 ms aimed for on five of the six pages (all but `/app/emergency`), for reasons the
cache cannot remove, because it holds only public chain and Safe data, never governance reads or upgrade states.
Traced on October 7 (a fresh process with the cache, the request sent at once; each upstream read timed):

- `/` and `/app/proposals` (340–374 ms): the list from the last run's history still needs two reads in a row from
  this run: the history above the saved part (the unfinalized tail, about 70 blocks) and the upgrades' states at
  the head. At the start each took 190–210 ms, beside the backfill's first eight batches of 25 ranges.
- The upgrade, emergency upgrade and veto pages (628–757 ms): they wait for governance (member Safes, thresholds,
  domains), which a fresh process reads in four rounds one after another: 615–740 ms at the start. The upgrade
  page's data came at 682 ms and the veto page's at 684 ms in the trace, right after governance.

Under 300 ms these pages would need governance read in fewer rounds, the states read beside the tail, or
governance kept between runs, which the cache's rule excludes.

### How it works now

- **Lanes** (`app/.server/chain/jsonrpc.ts`): upstream JSON-RPC reads go through lanes that allow only read
  methods, batch requests (up to 20–25 per POST), keep at most 8 POSTs in flight and adapt to rate limits and
  "too large" errors. History reads yield to request reads.
- **Log indexes** (`chain/puh-index.ts`, `chain/l2-index.ts`): the ProtocolUpgradeHandler's whole log history is
  read once, at the start: one full-range request where the RPC allows it, otherwise 10,000-block chunks, newest
  first. Logs up to the finality boundary (the lower of head − 64 and the `finalized` block) are kept; the tail
  above it is read again at every new head and replaces the previous tail. Lists and id lookups read the index and
  wait (bounded) rather than answer from part of it. The ZKsync Era governors' proposal events are indexed the same
  way, so the veto pages no longer search for blocks by timestamp.
- **Revert classification** (`chain/call.ts`): only a definite revert is a negative verdict. An RPC failure (rate
  limit, timeout, internal error, out of gas) is an error, never `invalid`, `missing`, `rejected` or `reverted`; a
  check against an address without code is an error, never an acceptance.
- **Sync engine** (`sync/engine.ts`): follows the head (on mainnet no block can come before the next 12 s slot, so
  it polls once a second only from then) and at each new block refreshes what requests read: the index tail,
  governance, upgrade states, Safe info and the signature sets pages showed. Verdicts are keyed by the block's hash,
  so a reorg never serves a result from an orphaned block. A new head is served once what requests read at it is in
  memory, the watched signature sets verified at it included (at most 2 s after it was seen; at once when the
  previous head was confirmed by the clock and that may have been wrong); until then requests read the block
  before. The engine never answers by itself: stopped or failing, requests read on demand within the same bounds as
  before (head 4 s, governance 30 s, Safe 60 s).
- **Safe store** (`safe/store.ts`): a listing is used for 60 s after it arrived. A request's Safe reads go ahead of
  background reads (at most 4 in flight, 220 ms apart with a key, 550 ms without). With a key or a self-hosted
  service, a background sweep re-checks the listings of the signer groups in use before they turn 60 s old (one
  small "newest message" request; the full listing only when it changed), and every member Safe at an interval
  paced by the quota left. A listing read again keeps the objects of the messages that did not change, so each
  message's typed data is parsed and hashed once (`flows/messages.ts`), not by every page before its first bytes.
- **Pages first**: no page loader waits on the network before the first flush; the shell, navigation and each
  section's pending state render at once, trust banners say "checking" until governance is read, and each section
  streams as its reads finish.
- **Warm-up** (`prewarm.ts`): right after the start, the network, governance, the log-history canary, both log
  indexes and (with a key) the member Safes' listings are read before anyone asks, and the messages of the listings
  held (read now or by the last run) are parsed.

### Freshness: pages and JSON

JSON (`/api/*`) answers as before: only with Safe copies at most 60 s old, verdicts read at the current head and this
run's own log history. It waits for them. Every signature set carries `verifiedAtBlock` and `safeFetchedAt`, and
`stale` is always `false`.

A page may show first what the app already holds, always labelled, and the current result replaces it in the same
streamed response:

- Safe copies older than 60 s: "Safe copies from 2m ago · refreshing". Safe data is only candidate input and every
  verdict comes from an `eth_call`, so an older copy can only show fewer signatures than Safe now holds.
- A set's last verdict at an older block: "Verified at block #N · re-verifying at #M". Nothing in it is shown in a
  passing colour, and nothing can be signed or sent from it.
- The history the last run saved: "History from last run · re-verifying".
- On a fresh process, an upgrade or emergency execution located directly while the history is still read: "Located
  directly · history index verifying". When the index completes, the two must agree; otherwise the page shows an
  integrity error.

Governance warnings, network overrides and `logHistory` are never shown from an older read (the status banner keeps
its 30 s bound), and verdicts are never kept between runs.

### The chain cache

`apps/web/.cache/chain/<chainId>-<first 8 hex digits of the genesis hash>.json` (folder 0700, file 0600, atomic
write) holds public chain and Safe data only: both log histories up to their finality boundary, timestamps of final
blocks, and the members' last Safe listings with the time Safe answered. Never verdicts, governance reads, settings,
RPC URLs or keys. At start the file is checked against the chain id and the genesis block (one batched call) and
seeded as provisional; the normal backfill reads the history again and must match it exactly, otherwise the file is
discarded and `sync.cache.state` is `mismatch` (a reason to stop and report, see AGENTS.md). It is saved when the
history is complete, at most once a minute when something changed, and on shutdown. `CHAIN_CACHE=0` turns it off;
anvil and hardhat never use it. Delete the folder to clear it.

### Settings and what they cost upstream

The engine and the Safe sweep spend the RPC's and Safe's quota ahead of requests. Counted as `sync.engine.cost`
counts: every JSON-RPC request (a batch entry counts one, a retry again) and every Safe GET, measured with the same
RPC and key on October 7 by the benchmark's `use`, `cost` and `head` conditions:

| Setting (default) | What it does | Measured cost |
| --- | --- | --- |
| `PREWARM` (on) | Right after the start: network, governance, the log-history canary, both log indexes and, with a key, the member Safes' listings | About 480 JSON-RPC requests in the first 4 s, nearly all the handler's history in 435 ranges of 10,000 blocks (one request on an RPC without a range cap). The backfill runs on first use without it |
| `SYNC_MODE` (`always`) | Follow the head for as long as the app runs. `window`: only while in use. `off`: nothing ahead of requests, as before this work | In use (`use`): 13,939 JSON-RPC requests an hour (10,887 L1, about 36 a block; 3,052 Era) and 510 Safe requests, over 10 minutes with one page a minute after every page was opened once (6 signature sets watched). While pages were read at every block (`head`): 19,762 and 1,107 an hour (5.5 minutes). Idle (`cost`): 2,584 JSON-RPC requests an hour (all L1, about 9 a block) and no Safe request in 10 minutes |
| `SYNC_KEEPWARM_MS` (600000) | How long after a request the app counts as in use (reads of `/api/status` do not count) | – |
| `SYNC_SAFE_ACTIVE_MS` (300000) | While in use, the signer groups a page showed in this window have their Safes re-checked before the copies turn 60 s old (one small request each; the full listing only when it changed) | About 1,000 Safe requests an hour for the three groups (17 Safes): 85 in the 10 minutes of `use`, nearly all in the first 5, while they were kept |
| `SYNC_SAFE_HOURLY_BUDGET` (1200) | At most this many background Safe requests an hour; sweeps also pause below 10 % of the quota and during a rate-limit cooldown. Only with a key or a self-hosted service | – |
| With `always`, quota-paced | Every member Safe is checked once per max(10 min, Safes × time to the quota's reset / (left − 20 % of the limit)), every 15 min without quota headers | Every 23.9–24.0 minutes with 39,488 of 50,000 left: about 43 Safe requests an hour |
| `CHAIN_CACHE` (on) | The chain cache above | One batched call at the start; the backfill runs anyway |

So an always-on instance spends about 62,000 JSON-RPC requests a day while nobody uses it, and about 330,000 a day
while it stays in use; that is more than some free RPC plans allow. `SYNC_MODE=window` spends nothing while nobody
uses the app (the first request after that reads on demand, as without the engine), and `SYNC_MODE=off` never reads
ahead.

### Validation

- `corepack pnpm --filter web test`: 154 unit and 800 server tests pass, including the engine, Safe store, verdict
  memo, page freshness, chain cache, instant-flush and benchmark helper tests. `corepack pnpm typecheck` passes for
  every package, and Biome is clean on the changed files.
- `corepack pnpm test:i` (mainnet, read-only): 4 of 4 pass. `corepack pnpm test:fork` (anvil fork): 5 of 5 pass.
- Playwright (`corepack pnpm --filter web build && cd packages/e2e && corepack pnpm test:web`, Node 20.18.1 and
  `PW_CHANNEL=chrome`): 12 pass, 2 fail as before this work: `verify.spec.ts:13` and `verify.spec.ts:67` expect
  executed emergency upgrades on the landing and emergency pages, which show only the last 7 days. (The suite's
  setup needs Node 20.11 or later, for `import.meta.dirname`.)
- The benchmark checked `/api/status` when each server started, after every measurement and when each server
  stopped: no governance warnings or overrides, log history `ok`, chain cache never `mismatch`. Every answer had
  status 200. No server log contained a URL other than the local one.
- It also noted when a page first showed something labelled as older or unconfirmed (a stale set, a count from
  older copies, history from the last run). That marker is page-wide: it shows that a labelled item came in the
  same chunk as each page's first data (with the cache, with Safe copies older than 60 s and idle), not that every
  older item on the page was checked; the labels themselves are covered by the unit and server tests.
  `/app/proposals`, which reads no Safe data, showed none in the last two conditions.
- Single runs vary: an earlier full run the same day (before the October 7 fixes above) differed from this one by up
  to a third on some first-request rows (`/api/emergency` without the cache: 8,005 against 5,208 ms), and a re-run
  of three conditions by up to half (the emergency upgrade page with the cache: 7,345 against 4,979 ms).

Reproduce from `apps/web` after `corepack pnpm --filter web build`:
`corepack pnpm exec tsx test/support/benchmark-sync.ts` (read-only; about 30 minutes; `--only=fresh,cache` and so on
for some conditions). It starts its own servers on ports 3105–3109, stops on governance warnings, overrides, a log
history that is not `ok`, a chain cache mismatch or log indexes that do not finish reading, reports an HTTP error as
a failure rather than a timing, prints no URL or key, and writes its results to `.cache/local/benchmark-sync.json`
at the repository's root (the servers' logs to `.cache/local/benchmark-sync/`). The "after" columns, the cost table
and the counts above come from one run of it (October 7, 09:55–10:23 UTC); the "before" columns, the traces of the
chain cache case and the figures given for before the October 7 fixes come from earlier measurements.

## October 5: locate emergency executions without scanning deployment history

For a known ID, discovery now searches the ProtocolUpgradeHandler's permanent
`upgradeStatus(id).executed` transition using at most eight concurrent historical reads per round.
It then requests `EmergencyUpgradeExecuted(bytes32 indexed id)` from that single block. The flag
alone never establishes an emergency: standard upgrades set it too, so the matching indexed event
is required. Contradictory historical state falls back to logs; archive-unavailable RPCs retain an
ID-filtered deployment-to-head scan. RPC failures stay visible, and duplicate events are rejected.

Emergency details stream the current status first, then execution calldata and its historical
contract checks independently of current Safe copies. The original three EIP-712 digests and
signature checks are unchanged. JSON waits for all checks and byte comparisons with Safe.

The default emergency page and overview scan only the last seven days of executions. The window
is explicit, with a **Show full history** link and direct ID lookup for older executions. Pending
IDs come from member Safe messages and are classified with batched current contract reads, without
waiting for a history scan. Safe failures and unexpected hashes are shown as an incomplete list.
The JSON list still returns deployment-to-head history by default.

Two cold measurements of the wired discovery path for
`0xb1660380be18f4cf30cb1a253d3e91da3e584ca7ae82d7d6fd9675a722d6da5e`
took **1,949 / 1,959 ms**, each with **57 historical calls, 12 HTTP requests, and one single-block
log query**. Both found block **25766164** and transaction
`0xb5b9c800a5df2db38d237f6ce4ee144b2079fdfcc1ea717566f80094e5a439dd`.
The previous deployment-wide scan covers about 435 ranges at the configured provider's 10,000-block
limit. A full historical listing still requires that scan; the state search accelerates known IDs.

In WebKit with a normal Safari user agent and cleared local caches, the cold desktop page displayed
status at **1,391 ms**, calls plus historical checks at **5,700 ms**, and current Safe results at
**6,891 ms**. The warmed mobile visit displayed calls at **854 ms**, completing at **924 ms**.
The default list completed in **4,915 / 4,401 ms**. Browser checks found no JavaScript errors or
horizontal overflow. These timings include RPC and Safe variability and are not guarantees.

All **128 web tests** pass, including exact block boundaries, bounded concurrency, archive fallback,
event confirmation, independent streaming, pending state classification, and JSON completeness.
Workspace TypeScript and the production build pass; changed files pass Biome. Root Biome also
scans existing vendored `packages/contracts/src` and fails on their pre-existing diagnostics.
The workspace test run passes all web tests and 147 CLI tests; two unrelated CLI `EnvBuilder`
tests time out while fetching the Era contracts Git repository, and nine CLI tests are skipped.
The read-only mainnet status is clean: no governance warnings or overrides, log history `ok`.

Reproduce discovery from `apps/web` with
`pnpm exec tsx -r dotenv/config test/support/benchmark-emergency.ts`, and browser timings from the
root with `node scripts/benchmark-emergency.mjs`. The latter clears only local read caches.
The production preview was rebuilt and restarted at `http://127.0.0.1:3000`.

## October 5: keep proposal content independent of background verification

The streamed overview now contains only the on-chain status, original calls, ID recomputation,
and timeline. L2 discovery, execution transaction/simulation, recorded approvals, and current
signature verification start independently as soon as those core reads finish. Each section has
its own pending/error state; a stalled optional lookup cannot hold up the core or start of signature
checks. JSON still waits for the complete engine result. L2 lookup failures on the page are labelled
unavailable, rather than reported as a missing vote.

The proposal list seeds the existing original-event cache from its RPC logs, eliminating another
timestamp-to-block search when opening a listed proposal. No verification freshness TTL was
increased. Mainnet status and signature validity are still read and checked on-chain.

Slow-read instrumentation found large history scans filling the shared transport queue: sampled
`eth_getLogs` requests waited 10–20 seconds before being sent. Historical chunks now use a
two-request pool, leaving transport capacity for foreground contract, receipt and short event reads.
Only explicit range/result-size errors cause adaptive splitting; network failures and timeouts do
not shrink the learned range or create more chunks. A provider's explicit numeric range cap is
used directly, avoiding repeated probes and unnecessarily small chunks. A failed scan suppresses
unsent chunks.

Read timeouts are bounded at 10 seconds per attempt, with at most two retries instead of five.
Slow RPC logging records source, method, elapsed time, queue time, and failure status. Proposal
logging records stage and full ID. Neither records RPC URLs, keys, calldata or signatures.

Hermetic tests cover independent streaming, JSON completeness, bounded history chunks, foreground
progress during a scan, and timeout handling without fan-out. Verification logic is unchanged.

The rebuilt/restarted preview passed 22 unit and 84 server tests, TypeScript, formatting and build.
In WebKit, clicking this proposal from the recent list displayed its core in 840 ms on desktop
and 845 ms on mobile. The first visit finished its independent sections in 4,738 ms; the second,
with warmed immutable/Safe caches, finished in 934 ms. Both runs had no browser errors. The first
screen visibly showed separate pending states for L2 discovery, execution, recorded approvals,
and current signatures. Slow-stage logs measured those at 1,032/1,269/2,513/4,224 ms respectively,
running concurrently. These are observations on the configured RPCs, not a latency guarantee.

Reproduce the actual link-click workflow with `node scripts/benchmark-proposal.mjs` from the root.
The script checks trust status first and captures desktop/mobile screenshots plus timing data.

## October 5: discover the L2 proposal through its exact batch

The standard upgrade detail now passes its `UpgradeStarted` transaction hash to L2 discovery.
The transaction is read and, when needed, unwrapped from a Safe execution. Its `startUpgrade`
calldata supplies the L2 batch number; the decoded proposal must recompute to the requested L1 ID
before that batch is used. Viem's ZKsync `getL1BatchBlockRange` action calls the same RPC method
exposed by the ZKsync ethers SDK, without adding another dependency.

Within that batch, discovery filters the messenger's `L1MessageSent` event by its indexed message
hash. It recomputes the hash from the body, confirms the event exists in the successful receipt
inside the batch, and reads `ProposalExecuted` from the configured protocol governor in the same
transaction. The sender can be a timelock, so it is not assumed to equal the governor.

Missing or undecodable calldata, an unavailable batch RPC, and a missing validated match all retain
the previous timestamp-window search. RPC errors are not converted into a successful match.
The JSON and page engines use the same result. Existing signature checks are unchanged.

Read-only comparison for upgrade
`0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa`, using the
same configured RPCs, with application/scan caches reset before every measurement:

| Discovery path | Run 1 | Run 2 | Upstream HTTP requests |
| --- | ---: | ---: | ---: |
| Previous 21-day search | 4,987 ms | 5,112 ms | 31 |
| Exact batch | 606 ms | 611 ms | 4 |

Order was previous/batch/batch/previous; network initialization occurred before timing/counting.
The new path includes its extra L1 transaction read. Average discovery time fell from 5,050 ms to
609 ms (about 8.3× faster, 88% less time), with 87% fewer HTTP requests. Both runs of both paths
returned exactly the same governor, proposal ID, and execution transaction:

- Governor: `0x76705327e682F2d96943280D99464Ab61219e34f`
- L2 proposal ID: `49883493212277767948924829453899549013679463473253620701602979414799679547598`
- Execution transaction: `0x282aee550b7bc7d0396f30d0127445616beb4a057f720f1a0653c153bc20b062`

Reproduce from `apps/web` with `pnpm exec tsx -r dotenv/config test/support/benchmark-discovery.ts`.
The script stops on governance warnings, overrides, or unavailable log history and asserts all
discovery results agree. Measurements depend on RPC latency and are not whole-page timings.

Validation: 79 server tests, TypeScript, formatting, and production build passed. The restarted
preview rendered this proposal in WebKit without browser errors. On a fresh server the overview
appeared in 4,915 ms and network activity settled in 9,261 ms; L1 history and Safe verification
remain additional work. The earlier server's warm overview took 917 ms, so that browser reading
is not a valid cold before/after comparison and is not used to claim a whole-page speedup.

## October 5: fewer upstream requests

Both L1 and L2 HTTP transports now collect independent JSON-RPC reads for 5 ms and send bounded
arrays (up to 8 requests on L1, 4 on L2). L1 contract Multicall batching remains enabled; HTTP
batching additionally covers block, transaction, receipt, log, and initialization reads. Network
initialization reads chain ID, client version, and Multicall bytecode concurrently.

Providers returning HTTP 400/413 or a non-array invalid-request/method response fall back to
individual requests for that client's lifetime. Changing RPC settings recreates the transport.
Individual contract/RPC failures and rate limits are not treated as lack of batch support; normal
error reporting and bounded retries remain in place. Tests exercise reordered response IDs,
bounded bursts, supported and unsupported providers, and preservation of RPC errors.

Concurrent scans of the same recent log range now share their in-flight request. The result is
discarded on completion or failure, so later scans still re-read recent blocks, including on
rewindable local forks. Historical ranges retain their existing in-memory cache. No freshness
TTL was extended, and no verification result is persisted to disk.

Validation: 22 unit and 72 server tests passed, as did TypeScript, formatting, and the production
build. The bounded-burst test verifies that ten distinct reads use three HTTP requests (4/4/2).
The restarted preview passed its read-only trust preflight. A WebKit navigation pass reported no
browser errors: cold home data appeared in 905 ms, warm pages in 52–69 ms, and navigations in
54–60 ms. These timings are similar to the prior preview; this pass reduces request traffic rather
than demonstrating a further reduction in end-to-end cold latency.

## October 5: faster initial display and local preview

The page shell now streams immediately while governance is being read. A pending screen explicitly
says the RPC, contract roles, and network status are being checked; it never displays a successful
verification or assumed roles. Once the root read completes, the pages, footer, wallet controls,
and explorer links all receive that resolved governance snapshot through one shared context.

Further changes:

- Read member-array getters in bounded batches rather than one RPC round trip per member. Viem's
  existing Multicall3 batching combines the reads. Index order, the first-failure stopping rule,
  the 64-member ceiling, addresses, and threshold checks are preserved.
- Check log-history availability alongside governance instead of waiting for governance first.
- Share in-flight cache reads even if the provider takes longer than the TTL. Freshness starts
  when a read finishes. A cache clear never reinstates a superseded result; errors are retryable,
  and zero TTL still disables caching.
- Start fetching navigation/action destinations on hover or focus (`prefetch="intent"`).
  This is [Remix's documented prefetch behavior](https://v2.remix.run/docs/components/link/#prefetch).
- Serve Inter and JetBrains Mono locally, with `font-display: swap`, and preload the body font.
  There is no render-blocking Google Fonts stylesheet or external font connection. The original
  typefaces are retained; SIL Open Font Licenses are included in `apps/web/public/fonts`.
- Run the local site as the optimized production preview, with fingerprinted browser assets,
  rather than development modules. Changes require a rebuild/restart; hot reload remains available
  with `pnpm --filter web dev`.

Read-only WebKit observations on the current local mainnet configuration (one run, not a guarantee):

| Observation | Before | After |
| --- | --- | --- |
| Cold home page, actual governance page visible | 1,792 ms | 886 ms |
| Cold home page, browser initialized | 2,089 ms | 895 ms |
| Settings, page visible | 81 ms | 59 ms |
| Upgrade list, page visible | 61 ms | 38 ms |
| Navigation to settings after hovering | 79 ms | 59 ms |
| Navigation to emergency after hovering | 68 ms | 57 ms |

A separate cold-read run saw the HTTP response start in **19 ms**, the explicit pending screen in
**50 ms**, and the verified governance page in **862 ms**. This separates initial responsiveness
from the time needed to finish chain reads. RPC/Safe verification and streamed list summaries can
still finish later; they are not labeled complete early. Existing block labels and the Refresh
control retain their role in showing and refreshing the cached chain snapshot.

Validation: all 86 web tests pass, including regressions for concurrent member ordering, slow-read
deduplication, cache invalidation, zero TTL, and missing governance context. Type checking,
formatting, and the production build pass. Browser verification covers the site's pages at desktop
and mobile sizes, with light/dark browser appearance preferences. Governance status is `ok`, with
no warnings or trust-anchor overrides, and log history is `ok`. No wallet signing or transaction
sending was performed.

Reproduce local timing with `node scripts/benchmark-web.mjs`. Reports live under `.cache/local/`.
It performs a local cache refresh and read-only browsing, never a write to Safe or mainnet.

The sections below record the earlier October 2 work and measurements.

## Implemented

- Safe quota exhaustion establishes a shared cooldown until the provider's reset time. Without
  a reset header, the app probes again after one minute. Transient rate limits respect `Retry-After`.
- Queued Safe requests are cancelled promptly when the cooldown starts. Refresh does not bypass it.
- Connection and HTTP failures are remembered briefly for the affected request instead of repeatedly
  waiting on an unavailable source. Failures remain errors, never empty successful results.
- Standard upgrade pages stream proposal data, recorded approvals, and current signature sets
  separately. Historical checks use the actual transaction signatures independently of Safe copies.
- The JSON API uses the same verification engine and waits for the complete result. Contract checks,
  full hashes, and explicit unavailable states are preserved.

## Measurements

Read-only measurements against the local production server and public mainnet RPC on 2026-10-02:

| Observation | Before | After |
| --- | --- | --- |
| Overview complete response | 27–30 s | about 4–5 s |
| Cold upgrade complete response | 34–35 s | about 9 s |
| Repeat upgrade browser load | — | under 1 s |

With a normal browser user agent, the overview rendered before its summaries finished. Cold upgrade
proposal data appeared at 7.4 s, followed by historical evidence at 9.2 s. These are observations,
not latency guarantees; RPC speed, cache warmth, and network conditions affect results. Earlier
headless measurements waited for all content because the server treats bots differently.

## Validation and limits

- All 66 hermetic web tests, web lint, type checking, and the production build pass.
- Regression tests cover queued request cancellation, quota recovery, transient cooldowns,
  unavailable results, independent historical verification, and complete JSON results.
- Desktop and mobile browser checks report no JavaScript errors or horizontal overflow.
- Mainnet status has no governance warnings or network overrides; log history is `ok`.
- Safe's monthly quota remains exhausted. This change removes repeated waiting; it does not restore
  access to signature copies. A restart clears the in-memory cooldown and makes a new probe.
- Persistent caching and reducing the remaining chain-read latency are future improvements.
