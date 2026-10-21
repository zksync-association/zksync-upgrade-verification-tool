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
