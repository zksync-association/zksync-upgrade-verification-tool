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
| `PREWARM` | `0` turns off the reads made right after the start (network, governance, both log histories and, with a Safe API key, the member Safes' listings, whose messages it then parses); the first pages then make them |
| `SYNC_MODE` | `always` (default): follow the chain head and refresh what pages read before they ask, for as long as the app runs, doing less while nobody uses it (measured on mainnet: about 2,600 RPC requests an hour idle, 14,000 in use). `window`: only while it is in use. `off`: every request reads on demand |
| `SYNC_KEEPWARM_MS` | How long after a request the app counts as in use (default `600000`, 10 minutes) |
| `SYNC_SAFE_ACTIVE_MS` | While in use, the Safe listings of the signer groups a page showed in this window are re-read before they turn 60 s old (default `300000`). Needs `SAFE_API_KEY` or a self-hosted Safe service |
| `SYNC_SAFE_HOURLY_BUDGET` | Most background Safe requests an hour (default `1200`; `0` turns them off). Requests a page or `/api/*` call needs are not limited by it |

[AGENTS.md](AGENTS.md) is for running and checking it with an agent, and running the tests.
The upgrade verification CLI for deep upgrade analysis lives in [apps/cli](apps/cli/README.md).

Licensed under MIT.
