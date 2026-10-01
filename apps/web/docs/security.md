# Security model

**What you trust.** Your RPC (`L1_RPC_URL`), the ProtocolUpgradeHandler address pinned in
`app/common/networks.ts`, and the code you run. When you use a hosted instance, add its operator. Everything else is
derived from the handler through your RPC: councils, members, thresholds, nonces, EIP-712 domains. The app checks the
contracts against each other and shows a red banner if they disagree, and an amber one if a pinned address was
overridden by an environment variable.

**What you don't trust.** The Safe Transaction Service. Its answers are only a place to look for signatures. A
message is used only if it is filed under the hash this app computes for that Safe and that action. A signature
counts only once the contract that will consume it (`checkSignatures`, or the Safe's `isValidSignature`) accepts it
in an `eth_call`. An RPC failure is reported as a failure, never as an invalid signature.

**What you check yourself.** Before signing, compare the domain hash and message hash on your hardware wallet with
the page. They are computed per member Safe and cross-checked against the Safe's on-chain `domainSeparator()`. Phishing
a signer still needs them to skip this check.

**Emergency payloads** are confidential until executed. The page checks a payload against the signed id in your
browser and never sends it to the server unless you press "Simulate". For confidential payloads, run the app
locally rather than using a hosted instance.

**Incomplete data.** Some RPCs return empty `eth_getLogs` results for old blocks instead of an error. A canary
(the handler's deployment event) detects this, and the app then warns that lists may be incomplete. Pages opened by
id still verify, because they read state directly.

**Hosting.** The Docker image runs as a non-root user and keeps no state. A public instance should set
`SAFE_API_KEY`, sit behind TLS (the app redirects `X-Forwarded-Proto: http`) and keep the built-in rate limits.
