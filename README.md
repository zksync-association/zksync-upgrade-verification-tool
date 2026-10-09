# ZKsync Governance

Check ZKsync governance actions and their signatures yourself. The web app reads every proposal from the chain
through **your** RPC, fetches members' signatures from the Safe Transaction Service, and counts a signature only when
the governance contract itself accepts it in an `eth_call`. It keeps only a local cache of public chain and Safe data
(its log history is read from the chain again at every start; saved Safe copies are shown with their age until Safe is
read again) and never posts to Safe.

It covers protocol upgrades (Security Council and Guardian approval, legal veto extension), emergency upgrades,
freeze / unfreeze / soft-freeze threshold requests and Guardian vetoes of L2 proposals. For each it shows what is
signed, the hashes a Safe owner's hardware wallet displays, who has signed, whether the threshold holds, and the
calldata to execute.

## Run it

Needs git and Node.js 20 or newer. Use your own Ethereum mainnet or Sepolia RPC with log history (any
archive RPC works, e.g. `https://mainnet.gateway.tenderly.co`); the network is detected from it.

```bash
git clone https://github.com/zksync-association/zksync-upgrade-verification-tool.git && cd zksync-upgrade-verification-tool && L1_RPC_URL=<your RPC URL> npm start
```

Then open http://localhost:3000. The same build runs in the CI Docker image:
`docker build -t zksync-governance . && docker run --rm -p 3000:3000 -e L1_RPC_URL=<your RPC URL> zksync-governance`

## Sign

Signing happens in your own Safe and needs no setup. With the app running, open your member Safe in Safe{Wallet}
and add `http://localhost:3000` as a custom Safe App (**Apps → My custom apps**). When Chrome asks whether
app.safe.global may access apps on this device, allow it; otherwise Safe{Wallet} reports that the app doesn't
support Safe Apps. Open it there: it is already connected to your Safe. Go to the action and press **Sign**, then
compare the hashes on your hardware wallet with the ones on the page (Safe{Wallet} shows the same ones under
**SafeMessage details**). Once your Safe's owners have confirmed, the signature appears on the page for everyone,
verified on-chain.

You can also connect your Safe over WalletConnect: start the app with `WALLET_CONNECT_PROJECT_ID` set (free at
[cloud.reown.com](https://cloud.reown.com)).

## Optional settings

| Variable | Use |
| --- | --- |
| `L2_RPC_URL` | ZKsync Era RPC for vetoes and L2 links (default: the public one) |
| `WALLET_CONNECT_PROJECT_ID` | Lets members connect their Safe over WalletConnect |
| `SAFE_WALLET_ORIGINS` | Safe{Wallet} origins that may open the app as a Safe App (default `https://app.safe.global`) |
| `SAFE_API_KEY` | Safe API key. Without one, Safe allows 2 requests/s and 5,000 a month per IP: enough for one signer, not for a hosted instance |
| `UPGRADE_HANDLER_ADDRESS`, `SAFE_TX_SERVICE_URL`, `ZK_*_GOVERNOR_ADDRESS` | Overrides for local chains. The app warns when a pinned address is overridden |
| `CHAIN_CACHE` | `0` turns off the local cache of public chain and Safe data kept between runs in `apps/web/.cache/chain/` (logs, block timestamps, Safe listings; never verdicts, settings or keys). Delete that folder to clear it |
| `PREWARM` | `0` turns off the reads made once right after the start (network, governance, both log histories and, with a Safe API key, the member Safes' listings, whose messages it then parses); the first pages then make them. The warm-up does not start following the chain |
| `SYNC_MODE` | `window` (default): follow the chain head only while a page of the app is open and visible in a browser on this machine, re-reading at each new block only what is on screen; nothing is sent upstream while no page is (`/api/*` and `/api/status` read on demand and never count). Measured on mainnet: about 1,600 RPC requests (about 180,000 Infura credits) an hour with a page open. `always`: follow the head for as long as the app runs (what is on screen still only while it is), about as much with nothing open: for paid RPC plans. `off`: every request reads on demand |
| `SYNC_KEEPWARM_MS` | How long a visible tab's last beat (every 10 s) or a page load counts as use (default `30000`) |
| `SYNC_AWAY_MS` | A visible tab nobody has touched for this long stops counting as use until the next input (default `1800000`, 30 minutes; `0`: never) |
| `SYNC_SAFE_WATCH_MS` | While a signature set that can still be signed is on screen, the member Safes whose signature is not valid yet are asked this often whether their messages changed (default `60000`; one small request each, the listing only when it changed). Each set also has a **Fetch signatures** button that asks at once |
| `SYNC_SAFE_LIST_WATCH_MS` | The same for the Safes behind lists on screen: pending emergency upgrades, freeze requests, vetoes (default `300000`; those lists have a **Check Safe now** button) |
| `SYNC_SAFE_WATCH_KEYLESS_MS` | Without `SAFE_API_KEY` on Safe's public service, the two above at most this often (default `300000`; `0`: only on the buttons) |
| `SYNC_SAFE_HOURLY_BUDGET` | Most background Safe requests an hour (default `1200`; `0` turns them off). They also slow down when Safe reports little quota left, and pause below 10 % of it. Requests a page, a button or `/api/*` needs are not limited by it |
| `SYNC_VERDICT_AGGREGATE` | `1` (default): a set's signature checks at a block go out in one Multicall3 call with that block's other reads, and only acceptances are taken from it (anything else is asked again directly). `0`: every check is its own `eth_call` |
| `SYNC_CREDITS_PER_SECOND` | The most Infura credits a second the chain follower's own requests may use (default `450`; Infura's free plan allows 500; `0`: unpaced). Requests a page or `/api/*` needs are never held up |
| `SYNC_HEAD_POLL` | `slot` (default): look for the next block from the start of its 12 s slot, every second. `late`: from where most blocks have arrived by (learned); measured on mainnet, 2.6 head requests a block instead of 3.3, with blocks served about as soon (median about 10 ms later, measured at other blocks) |

`SYNC_SAFE_ACTIVE_MS` is no longer used (a value is ignored with a warning at start).

[AGENTS.md](AGENTS.md) is for running and checking it with an agent, and running the tests.
The upgrade verification CLI for deep upgrade analysis lives in [apps/cli](apps/cli/README.md).

Licensed under MIT.
