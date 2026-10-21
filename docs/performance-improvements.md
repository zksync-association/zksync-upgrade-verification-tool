# Performance improvements

## October 8: follow the chain only while a page is open

On October 7 the app followed the chain for as long as it ran (`SYNC_MODE=always`), and while someone used it, it
re-verified at every block every signature set a page had shown in the last ten minutes, one `eth_call` per member,
executed proposals included. Measured that day with the same Infura key: nobody using the app cost 8.5 L1 requests a
block (about 2,500 an hour, about 6.1 M Infura credits a day, twice Infura's free plan); with an upgrade page and an
emergency upgrade page in use it cost 59.2 a block (17,225 an hour, 1.43 M credits an hour), plus about 1,000 Safe
requests an hour and, while the veto list had been viewed in the last ten minutes, 3,066 ZKsync Era requests an hour.
An open page never updated itself.

Each signer runs the app on their own machine with their own RPC key, often a free plan, so this work makes three
changes. What counts as a valid signature is unchanged: the governance contract must accept it in an `eth_call` at
the current head.

1. **The app follows the chain only while someone uses it.** "In use" means a page of the app open and visible in a
   browser on this machine: the tab tells the server so every 10 s (and that it left when it is hidden, closed, or
   nobody has touched it for 30 minutes); a page load counts for 30 s. Nothing else counts: `/api/*` and
   `/api/status` read on demand, as do curl and agents. Nobody using it, the app sends nothing upstream at all. On
   the next visit a page first shows what it last showed, labelled with the block it was read at, until the current
   data replaces it about half a second later.
2. **While in use, what is on screen is re-read at every block, in as few requests as possible.** Normally one
   Multicall3 `aggregate3` carries everything a block can change for the pages on screen: governance's values that
   change (role addresses, freeze state, the soft-freeze threshold and nonces; the members, domains and constants
   are kept in memory while the contracts' code matches the pinned code), the upgrade states, and the signature
   checks of the sets on screen. Everything a page shows as current was read at that block, except governance's
   values that never change (kept as just said), the member Safes' info (owners, threshold, version: up to 5
   minutes old, read again in a block's aggregate before it expires; pages show it beside each member, and it tells
   "collecting" from "invalid"; it never decides whether a signature is valid), an upgrade read as executed or
   expired at a final block (not read again: it cannot change), and what comes from ZKsync Era (read once a minute
   while a page that shows it is on screen). A signature check in the aggregate counts only when it accepts (and only for plain ECDSA
   signatures checked by pinned code); anything else is asked again directly, where only a definite revert rejects.
   The follower's own requests are paced to at most 450 Infura credits a second.
3. **Safe is asked about what can change what you see, and a button asks at once.** While a set that can still be
   signed is on screen, the member Safes whose signature is not valid yet are checked every 60 s (one small "newest
   message" request each, the listing only when it changed; every 5 minutes without a Safe API key), within the
   hourly budget and the quota Safe reports. **Fetch signatures** on the set reads its Safes now and checks it again;
   lists fed by Safe have **Check Safe now** and are checked every 5 minutes. Executed or closed sets and valid
   members are never checked in the background. An open page learns from its next beat that what it shows changed and
   reloads its data in place, from memory.

### What it costs upstream

Read-only, on mainnet, with the same Infura RPC (10,000-block `eth_getLogs` cap), Safe API key and machine as on
October 7, measured on October 8 (04:53–06:16 UTC) by `apps/web/test/support/benchmark-sync.ts`, each condition on a
server of its own, the pages kept on screen by a browser tab that beats as a viewer's does. Requests are counted
where they leave the server (a batch entry counts one, as providers bill them); credits are an estimate at Infura's
published weights (`eth_getLogs` 255, `eth_chainId` 5, every other method 80). "Per block": per new L1 block in the
window.

| On screen | Window | L1 requests a block (an hour) | Infura credits a block (an hour) | Era an hour | Safe an hour |
| --- | --- | ---: | ---: | ---: | ---: |
| Nothing: 0–60 minutes after the last tab closed (chain cache on) | 60 min | 0 (0) | 0 (0) | 0 | 0 |
| Nothing, `SYNC_MODE=always` (since removed) | 15 min, 75 blocks | 5.32 (1,596) | 601 (180,169) | 0 | 0 |
| The upgrade page `0x77d5…` (executed) | 20 min, 100 blocks | 5.40 (1,620) | 611 (183,140) | 0 | 0 |
| The same with `SYNC_HEAD_POLL=late` (since removed) | 20 min, 98 blocks | 4.71 (1,386) | 556 (163,381) | 0 | 0 |
| Run A's two pages: that upgrade and the emergency upgrade `0xb166…` (executed) | 15 min, 75 blocks | 6.32 (1,896) | 683 (204,865) | 0 | 0 |
| `/` | 10 min, 50 blocks | 5.34 (1,602) | 606 (181,694) | 120 | 144 |
| The veto list | 10 min, 50 blocks | 5.44 (1,632) | 614 (184,089) | 120 | 96 |
| An open set: the pending emergency upgrade `0x4fa2…` | 10 min, 50 blocks | 5.28 (1,584) | 601 (180,254) | 0 | 138 |
| The same without a Safe API key | 10 min, 50 blocks | 5.38 (1,614) | 609 (182,653) | 0 | 0 (see below) |
| Two tabs hidden, or one hidden from its load (after the 30 s a load counts) | 3 min each | 0 | 0 | 0 | 0 |

An agent's JSON session (the AGENTS.md reads: status, the upgrade list, the upgrade and the emergency upgrade) sent
41 L1 requests (20 POSTs, 3,455 credits) and 3 Era requests for its four answers, and nothing in the ten minutes
after it; `sync.engine.active` stayed `false` throughout.

What a block costs with the upgrade page on screen: 3.30 head polls (`latest`) and 0.03 `finalized`, one
`eth_getLogs` for the index tail (1.00), one `aggregate3` (1.05; 71–162 sub-calls: governance's values that change,
the upgrade states and the three sets' signature checks; the blocks where the member Safes' info was due, every 4 to
5 minutes, had a second one), and the log-history canary every ten minutes (0.02). No direct signature check, no
governance round, no `eth_getCode`. Two detail pages add a second `aggregate3` a block (six sets). The most credits
sent within any one second (sliding, by send time) were 415 with one page and 495 with two, all of them the
follower's: with two pages, a head poll, the index tail and an aggregate at the start of a block (415), and
another aggregate 999 ms after the first request (80). The pacer counts a request when it lets it go, which can be a
few milliseconds before it is sent, so it saw those in two seconds and reports 415 at most
(`sync.engine.cost.pacer`), within its 450; sent, they came within one second to 495, still under Infura's 500. It
served each new head 0.23–0.31 s (median) after it saw it, 1.0 s with the two detail pages (their second aggregate
waits for the pace), and never later than 1.15 s.

Safe, with a key: executed pages cost nothing. The open set's five members whose signature is not valid yet were each
checked every 127 s, the 60 s stretched by the quota guard (141 background requests an hour allowed, with 33,664 of
50,000 left in Safe's month): 23 small checks in ten minutes, and no listing read again (nothing changed). `/` checks
the 17 Safes behind its lists every 7.2 minutes (the 5 minutes stretched the same way), the veto list the 8
Guardians' Safes every 5 minutes. **Fetch signatures** on the open set made 8 Safe checks and answered in 1.65 s, with
no RPC request (the set was verified at that head and nothing had changed). Without a key, Safe's public service
answered the server's first Safe request, the open page's listing read at its load (before the measured window),
with HTTP 429: this machine's IP had used up its 5,000 requests a month, and Safe asked for a pause of about 12 days.
The app then paused its Safe requests (`sync.safe.paused` `"cooldown"`). That server had read no Safe at its start
(without a key the warm-up skips Safe) and had no copies from a last run (`CHAIN_CACHE=0`), so the set's members had
no Safe data at all (members whose Safe could not be read are `unavailable`; on-chain approvals are still checked),
and the button reported that Safe did not answer for the 8 members. So the keyless cadence (every 5 minutes) could
not be measured live, and the watcher's bound held only because nothing was sent (the benchmark now reports that
check as not evaluated when the watcher was paused and sent nothing in the window; whatever it sent, paused or not,
is held to the bound, since the watcher reaches its budget and quota pauses by sending); the server tests cover the
cadence.

Era (the public ZKsync Era RPC): 120 requests an hour while `/` or the veto list is on screen (a head read and an
index tail a minute), none otherwise. Before: 3,066 an hour while the veto list had been viewed in the last ten
minutes.

Before and after:

| | October 7 | October 8 | Share |
| --- | ---: | ---: | ---: |
| Nobody using the app (the default mode) | 8.5 L1 a block (~2,500 an hour, ~860 credits a block, ~6.1 M a day), ~41 Safe an hour | 0 | 0 |
| Run A: the upgrade and emergency upgrade pages | 59.2 L1 a block (17,225 an hour), 4,911 credits a block (1.43 M an hour), 989 Safe an hour | 6.32 L1 a block (1,896 an hour), 683 credits a block (205,000 an hour), 0 Safe | 10.7 % of requests, 13.9 % of credits |
| The October 7 benchmark's in-use condition (C5): 10,887 L1, 3,052 Era (13,939 JSON-RPC) and 510 Safe an hour | | one upgrade page: 1,620 L1, 0 Era, 0 Safe an hour | 14.9 % of L1, 11.6 % of JSON-RPC |
| The most credits in one second, in use | 4,655 (6,095 with the veto list) | 415–495 | |

On Infura's free plan (3 M credits a day, 500 a second) a page open costs about 183,000 credits an hour, so it
allows about 16 hours a day of a page open, and nothing is spent while none is. A start still reads the handler's
whole history (about 117,000 credits with this provider), as before. `SYNC_MODE=always` cost about 180,000
credits an hour with nothing on screen (4.3 M a day); it has since been removed.

The aim was a tenth of the in-use traffic. On run A's basis requests fell to 10.7 % (credits to 13.9 %); on the C5
basis one page is 14.9 % of the L1 requests. What is left a block is the head polls (3.3) and the index tail (1, 255
credits), besides the one combined read. `SYNC_HEAD_POLL=late` lowers the polls from 3.30 to 2.61 a block (4.71
requests a block, 1,386 an hour against 1,620; 12.7 % of the C5 basis) and served heads about as soon as `slot`
(median 0.30 s, p80 0.33 s, at most 1.06 s, against 0.29 s, 0.32 s and 1.05 s: about 10 ms later, measured at other
heads in a run of its own, not side by side). October 7's rule makes `late` the default only if no head is served
later than with `slot`, which this does not show, so `slot` stayed, and `late` has since been removed. Reading the
tail only when the handler logged something was not adopted: it would change the rule that the history above the
finality boundary is read again at every head.

### How long things take

The first run unless said otherwise. JSON: the complete answer. Pages: first bytes · main section · main data ·
complete, in ms.

After a pause, with no page open (the follower stopped; nothing read ahead). JSON after 90 s and 10 minutes, and
the pages, from a second run of the `resume` and `idle` conditions on October 8 (08:29–09:32 UTC,
`--only=resume,idle`, after pages began to show what they last showed, below); JSON after 1 hour from the first run:

| JSON | After 90 s | After 10 minutes | After 1 hour | Warm, right after |
| --- | ---: | ---: | ---: | ---: |
| `/api/status` | 438 ms | 467 ms | 527 ms | 2–3 ms |
| `/api/upgrades` | 557 ms | 552 ms | (321 ms, not a first request) | 2–4 ms |
| `/api/upgrades?history=all` | 588 ms | 642 ms | (185 ms, not a first request) | 32–36 ms |

After 90 s and after 10 minutes each request came after a pause of its own. After 1 hour (the `json` condition of
the first run, not run again) the three came one after another, so only `/api/status` was a first request there:
the aim (the first JSON after a pause within about 1 s of warm) was measured for all three after 90 s and 10
minutes, and for `/api/status` alone after an hour. Each first request was within 0.65 s of warm. October 7
(`SYNC_MODE=window`, run B of that day's cost study): 0.77 s and 0.82 s for the first two. Detail JSON reads Safe
after a pause (above).

A page first sends, with its first bytes, its main data as this app last showed it, labelled "As of block #N ·
reading the newest block" (the block those reads were made at; the counts on `/` say "As of block #N ·
re-verifying", the Safe-fed lists "Verified at block #N · re-verifying" with their Safe copies' age). It is shown
in no colour, with nothing to sign, send or download from it, and the current data replaces it in the same response
once the newest block and the reads at it are in (0.4–0.5 s, as measured in the first run). Only pages do this, and
only from this process's memory: what a section showed as current (nothing from the last run's history, nothing
located directly, no Safe copy older than the page rule allows) is kept for the next page that finds no head in
memory; never across a settings change, never on a dev node, never for JSON. A page not shown since the app started
has nothing kept: it sends its frame and sections at once and its data after those reads (the first run: first bytes
19–36 ms, data 0.4–0.5 s). So the benchmark now shows the six pages once before each pause.

| Page: first bytes · data · complete, in ms | After 90 s (each after its own pause) | After 10 minutes / 1 hour (one after another) |
| --- | --- | --- |
| `/` | 30 · 30 (as last shown) · 4,661 | 40 · 41 (as last shown) · 4,532 / 40 · 42 (as last shown) · 5,800 |
| `/app/proposals` | 30 · 30 (as last shown) · 614 | 15 · 18 · 19 / 19 · 22 · 23 |
| `/app/proposals/0x77d5…` | 31 · 33 (as last shown) · 916 | 19 · 22 · 400 / 16 · 19 · 416 |
| `/app/emergency` | 22 · 23 (as last shown) · 674 | 10 · 13 · 14 / 12 · 15 · 15 |
| `/app/emergency/0xb166…` | 14 · 16 (as last shown) · 808 | 21 · 23 · 361 / 14 · 16 · 1,055 |
| `/app/l2-cancellations` | 34 · 35 (as last shown) · 2,199 | 11 · 13 · 14 / 9 · 11 · 12 |

After 10 minutes and 1 hour the pages came one after another: only `/` came after the pause, and the others found
the head it read (the app in use again) and had their current data at once. `/` takes 4.5–5.8 s to complete
because its current counts read the 17 Safes behind its lists again. On October 7 the follower kept running after a
pause (`SYNC_MODE=always`), and the same pages had their data within 19–31 ms, at the cost above.

The aim for pages after a pause (each page's last-known data, labelled, in its first flush, first bytes within 50
ms) was not met by the first run: the pages then waited 0.4–0.5 s for their data, and the review left two ways open
(pages show what they last showed, labelled with its block, or the aim becomes "frame and sections within 50 ms,
data in about half a second"). The first was taken, as the aim and the user's decision of October 7 ("pages show
the last-known data, labelled") describe, and the second run measured it: the benchmark's check of the aim (each
page's data, current or older and labelled, within 50 ms of its first bytes, the first bytes under 50 ms) holds for
the six pages after 90 s, after 10 minutes and after 1 hour.

A page open (the follower running): warm, every path read once before; new block, each path the moment the engine
served a new head.

| | Warm | New block |
| --- | --- | --- |
| JSON: status and lists | 1–33 ms | 1–20 ms |
| JSON: the upgrade and emergency upgrade details | 3–5 ms | 3–20 ms at 3 of 14 blocks, 0.2–2.6 s at 10, 4.8 s at one (Safe read again) |
| JSON: vetoes, freeze | 1 ms | 378–419 ms (Safe read again) |
| Pages | 5–9 · 5–10 · 7–13 · 7–19 | 5–13 · 6–13 · 7–17 · 7–198; `/app/emergency` 3,868 (Safe) |

JSON reads Safe again once its copies are older than 60 s, and with only executed sets on screen nothing keeps them
younger: the detail endpoints took 0.2–2.6 s at most blocks measured 0–1.5 s after the engine saw a new head, and
`/api/emergency/0xb166…` 4.8 s once (its 16 listings). On October 7 the background sweep kept those copies under
60 s and the same requests took 4–25 ms (one block 544 ms). Pages show such copies labelled with their age and
finish when Safe has answered.

A new process with the chain cache (the six pages requested at once as it starts, the cache saved by the idle
condition's server): first bytes 124–151 ms (six at once while the process starts), data labelled "History from
last run" at 158–411 ms, complete 0.4–4.4 s; the JSON right after: 3–177 ms.

### Freshness: pages and JSON

JSON (`/api/*`) is unchanged: it answers only with what it read at the current head, Safe copies at most 60 s old,
governance at most 30 s old and this run's own log history, and it waits for them. It never keeps the follower
running and never reads what only pages may show. So a JSON detail request reads Safe again whenever its copies are
older than 60 s (about 4–5 s for the 16–17 member Safes with a key, about 9 s without), also while a page is open.

A page may show first, always labelled, what the app already holds: after a pause, what it last showed ("As of
block #N · reading the newest block"), Safe copies older than the page allows ("Safe copies from 2m ago ·
refreshing"), a set's verdict at an older block ("Verified at block #N · re-verifying at #M"), the history the last
run saved, or an upgrade located directly while the history is read: never in a passing colour, nothing to sign or
send from it. The current result replaces it in the same response, and an open page then follows each new block by
itself. That current result is verified at the head as JSON's is, but its Safe copies follow the page rule rather
than the 60 s one: the copies the watcher keeps checking for the screen are used for as long as their cadence
(measured up to 127 s with a key under the quota guard, 5 minutes without one), labelled "Safe checked 20s ago · next
check in 40s"; the copies of members whose signature is valid at the head, and of sets that cannot be signed any
more, whatever their age, labelled with it; any other copy is read again first. A Safe copy only supplies
candidates, so an older one can only show fewer signatures than there are.

### Validation

- `corepack pnpm --filter web test`: 193 unit and 998 server tests pass, including the benchmark's own helpers and
  checks and its tracer (`test/server/benchmark-sync.test.ts`, `upstream-trace.test.ts`: what a trace records, that
  a request counts in the window it was sent in even when answered later or never, that an answer, an error or a
  rate limit that comes after that window was dumped is counted in the window it came in, never as a request, and
  that a trace never holds a URL, host or key), and what pages show after a pause
  (`test/server/last-shown.test.ts`, `last-shown-pages.test.ts`, `test/unit/as-of.test.tsx`: the six pages' last
  current data at once with the block it was read at, never a newer block, the current data after it, nothing kept
  from a stale or unconfirmed answer, across a settings change or on a dev node, JSON never answering from it, and
  the labels, the absence of colour and of anything to act on). `corepack pnpm typecheck` passes, and Biome is
  clean on the changed files.
- `corepack pnpm test:i` (mainnet, read-only): 4 of 4 pass. `corepack pnpm test:fork` (anvil fork): 5 of 5 pass.
- Playwright (`corepack pnpm --filter web build && cd packages/e2e && corepack pnpm test:web`, Node 20.18.1 and
  `PW_CHANNEL=chrome`): 15 pass, 2 fail as before this work: `verify.spec.ts:13` and `verify.spec.ts:67` expect
  executed emergency upgrades on the landing and emergency pages, which show only the last 7 days.
- The benchmark checked `/api/status` when each server started, after each window in use, after the first request
  of each JSON pair and at the end of each condition (not during the idle windows or between the pages after a
  pause, where reading it would itself read the head and governance upstream): no governance warnings or overrides,
  log history `ok`, the chain cache never `mismatch` (and `verified` on the restarted process). Every answer had
  status 200 and no server log holds a URL other than the local one. No upstream request failed or was rate limited
  in a measured window; before its window, the keyless server's first Safe request got HTTP 429, which paused its
  Safe requests (above). Its checks, evaluated again on the first run's results with the benchmark as corrected
  after it: nothing upstream while no page was open, hidden or closed; JSON never started the follower; one page
  under 1,650 L1 requests an hour; Era at most 240 an hour; Safe for the open set within its members × 60 an hour;
  first JSON after a pause within 1 s of warm; first bytes under 50 ms on the six pages after each pause: these
  held. The keyless watcher's bound was not evaluated (Safe paused, nothing sent). Pages' data in their first flush
  after a pause did not hold in the first run (above); the second run (`--only=resume,idle`, after pages began to
  show what they last showed) passed all of its checks: nothing upstream for the 60 minutes after the use ended,
  first bytes under 50 ms and each page's data in its first flush on the six pages after 90 s, 10 minutes and 1
  hour, and the first JSON after a pause within 1 s of warm (its six first requests, after 90 s and 10 minutes).
- The first run counted the Era requests of servers whose Era RPC was never asked its chain id as "RPC of unknown
  chain"; the Era figures above are those requests (the benchmark now attributes them to Era itself).

Reproduce from `apps/web` after `corepack pnpm --filter web build`:
`PW_CHANNEL=chrome corepack pnpm exec tsx test/support/benchmark-sync.ts` (read-only; about 85 minutes; `--only=json,
upgrade,…` for some conditions, `--scale=0.1` for a short trial run). It starts its own servers on ports 3105–3110,
each with `test/support/upstream-trace.mjs` (each upstream request's method, block tag, selector, or Safe request
kind; never a URL, host, query string or key), keeps pages on screen in Chrome tabs, stops on a trust problem, prints
no URL or key, and writes its results to `.cache/local/benchmark-sync.json` at the repository's root (the servers'
logs and traces to `.cache/local/benchmark-sync/`). The tables above come from one run of it (October 8,
04:53–06:16 UTC), for `SYNC_HEAD_POLL=late` (since removed) from `--only=late` right after it, and for the pages
and JSON after a pause (90 s and 10 minutes) from `--only=resume,idle` (08:29–09:32 UTC); "October 7" figures are
from that day's benchmark and cost study.

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
RPC and key on October 7 by the benchmark's `use`, `cost` and `head` conditions (`SYNC_MODE=always` and
`SYNC_SAFE_ACTIVE_MS` have since been removed; `window` is the default):

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
