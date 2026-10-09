# Performance improvements

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
