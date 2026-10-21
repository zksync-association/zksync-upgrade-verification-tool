# Sepolia test deployment

A copy of ZKsync's governance contracts on Sepolia whose members one address controls, and a build of
the single file wired to it (`dist/verifier-sepolia-test.html`), to try signing and executing end to
end. It is not ZKsync's governance: nothing it shows is a real decision. `verifier.html` is
unchanged by it.

## What is deployed

Addresses in `deployment.json`, written by `deploy.ts`.

- **ProtocolUpgradeHandler**: zk-governance's `TestnetProtocolUpgradeHandler` (no legal veto period,
  no delay after approval) behind a `TransparentUpgradeableProxy` that owns its own `ProxyAdmin`, as on
  mainnet.
- **SecurityCouncil** (8 members: 4 to approve an upgrade, 3 for a soft freeze, 6 for a hard freeze,
  an unfreeze or a new soft-freeze threshold), **Guardians** (8 members: 5 to approve or veto, 2 to
  extend a legal veto) and the **EmergencyUpgradeBoard**. zk-governance at `58df93f`, compiled as
  mainnet's: the same code as mainnet's but for immutables and metadata.
- **17 member Safes**, each Safe 1.3.0 (as on mainnet) with one owner, `0xF378…E885`, and threshold 1:
  8 for the Security Council, 8 for the Guardians, 1 for the ZK Foundation.
- **ZKsyncTestStub** in every role the contracts give ZKsync (Era, the chain type manager, the
  bridgehub, the bridges). It proves any L2 message, so anyone can start any upgrade, and accepts any
  call: freezes and vetoes succeed and change nothing on ZKsync.
- The L2 side is ZKsync Era Sepolia's: its RPC and governors. The handler's `L2_PROTOCOL_GOVERNOR`
  is the Sepolia ZkProtocolGovernor's timelock.
- Upgrades started at deployment (`seeds.ts`): a copy of a 31-call mainnet upgrade (it signs and
  approves, but its calls go to mainnet's addresses, so it does not execute), and two one-call upgrades
  sent to the stub, which run to the end.

## Use it

1. Open `dist/verifier-sepolia-test.html`. In Settings, save a Sepolia RPC with log history (Infura or
   Alchemy) and a Safe API key. The page keeps its own settings, wallet session and payloads
   (`sepolia-test:` keys), apart from `verifier.html`'s.
2. In Safe{Wallet} on Sepolia, connect `0xF378…E885`: it owns all 17 Safes. Address book → Import
   `safe-address-book.csv` names them.
3. In the page, **Connect wallet** → Copy link. In Safe{Wallet}, open a member Safe → WalletConnect →
   paste the link. **Your signature** then offers that member's signature. To sign as another member,
   disconnect and connect that Safe.
4. Approvals and executions can be sent from any wallet with Sepolia ETH.

To try: a Security Council approval (4 signatures) makes an upgrade ready at once; the Guardians'
approval (5) makes it ready 30 days after it started. Freeze requests, emergency upgrades (prepare one
in the page) and their execution work as on mainnet. Not here: extending a legal veto (there is no
legal veto period), and vetoes need an active proposal on Sepolia's L2 governors.

## Build, deploy, start more upgrades

From `apps/web`:

```bash
# the page
corepack pnpm exec vite build --config standalone/sepolia-test/vite.config.ts && node standalone/inline.mjs standalone/sepolia-test/dist verifier-sepolia-test.html
# deploy (resumable: what exists is skipped); key in .cache/sepolia-test/deployer.key
corepack pnpm exec tsx standalone/sepolia-test/deploy.ts
# one more upgrade, from a JSON file in the emergency payload format
corepack pnpm exec tsx standalone/sepolia-test/start-upgrade.ts proposal.json
```

On an anvil fork of Sepolia (`SEPOLIA_RPC_URL=http://127.0.0.1:8545`), `deploy.ts` writes
`deployment.fork.json` instead; `SEPOLIA_TEST_DEPLOYMENT=./deployment.fork.json` builds the page for it.
