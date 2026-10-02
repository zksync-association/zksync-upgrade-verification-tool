# ZKsync Governance

Check ZKsync governance actions and their signatures yourself. The web app reads every proposal from the chain
through **your** RPC, fetches members' signatures from the Safe Transaction Service, and counts a signature only when
the governance contract itself accepts it in an `eth_call`. It stores nothing and never posts to Safe.

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
and add `http://localhost:3000` as a custom Safe App (**Apps → My custom apps**). Open it there: it is already
connected to your Safe. Go to the action and press **Sign**, then compare the hashes on your hardware wallet with
the ones on the page. Once your Safe's owners have confirmed, the signature appears on the page for everyone,
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

[AGENTS.md](AGENTS.md) is for running and checking it with an agent, and running the tests.
The upgrade verification CLI for deep upgrade analysis lives in [apps/cli](apps/cli/README.md).

Licensed under MIT.
