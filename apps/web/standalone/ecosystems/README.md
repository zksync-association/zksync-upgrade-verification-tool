# Another ecosystem's single file

`verifier.html` follows ZKsync's governance (mainnet, and Sepolia's built-in deployment). Another
ecosystem running the same zk-governance contracts gets a page of its own from a config here: its
ProtocolUpgradeHandler and L1 chain (mainnet or Sepolia, whose entry it replaces), its L2 (RPC,
explorer, diamond, governors), its contracts' names, and a storage prefix (its settings, wallet
session and caches apart from `verifier.html`'s). Everything else is read from the handler.

From `apps/web`:

```bash
ECOSYSTEM=testnet-3 corepack pnpm exec vite build --config standalone/ecosystems/vite.config.ts \
  && node standalone/inline.mjs standalone/ecosystems/dist-testnet-3 verifier-testnet-3.html
```

A config's `codePins` are keccak256 of the runtime code at the Security Council, Guardians and
Emergency Upgrade Board, and of a member Safe's proxy, with the Safes' singleton and fallback
handler (all members alike); `null` reads every check on-chain instead. Its handler's legal veto
and delay are 0 for TestnetProtocolUpgradeHandler, else 3 and 1.

Open the generated HTML directly from disk for the signer flow: use **Connect Safe / wallet**,
copy the WalletConnect pairing URI, then connect the member Safe in Safe{Wallet}. Review the
SafeMessage hashes and collect the Safe owners' signatures there. This flow uses the browser, RPC
and Safe service directly; no localhost server is required. For execution calls that permit any
sender, disconnect the signer Safe and connect a separate mobile wallet through WalletConnect.
Calls bound to a particular sender (for example, L2 votes) still require that sender.

The optional [tx-sim companion](../tx-sim/README.md) remains available over localhost for reviewed
Testnet 3 L1/L2 transaction arrays. It is not required for the serverless signer flow. Desktop
MetaMask and the companion navigation link are offered only when the verifier is served over HTTP(S).

For Testnet 3 Council approval, the served verifier also offers **Upgrades → open the upgrade →
Approve member Safes with MetaMask**. Connect the funded sole owner, review an approval, then
confirm its zero-value Safe transaction on Sepolia. Repeat for enough distinct member Safes to
meet the Council threshold (four on the current deployment). The existing Council approval
transaction becomes available only after governance verifies those on-chain Safe approvals.
Each member approval pays gas; no WalletConnect pairing to individual Safes is needed.

This shortcut supports the pinned Testnet 3 deployment's Safe 1.3.0 members with one owner and a
threshold of one. It rechecks the owner, governance digest, Safe configuration and library code,
then simulates the Safe call before opening MetaMask. Other Safe policies retain the normal Safe
signing flow. Pending or uncertain wallet submissions stay blocked against duplicate sends; use
**Check approval / retry if failed** to read its receipt. A matching, canonical reverted receipt
opens a new review and **Retry failed approval**; pending or uncertain submissions stay blocked.
An approval already recorded by the Safe refreshes the verified count instead of sending again.
For this specific approval the request reserves at least 1,000,000 gas for the complete wallet
transaction, or twice the direct-call estimate when larger (bounded at 2,000,000). The review
shows the limit; unused gas is not charged. This covers MetaMask's first 7702 authorization,
which was underfunded by the wallet's estimate even though the direct Safe simulation passed. Opening the same HTML from disk retains the Safe /
WalletConnect flow; desktop MetaMask requires serving it over HTTP(S).
