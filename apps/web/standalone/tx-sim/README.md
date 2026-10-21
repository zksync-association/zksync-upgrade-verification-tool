# Testnet 3 desktop sender

The tx-sim workflow can also be packaged as **one HTML file**, opened directly in Chrome. Its build
automatically fetches the latest private PR through your existing `gh` login, pins one revision, and
embeds all transaction files, ABIs, scripts and styles. No GitHub token enters the file. Opening a
GitHub tab cannot share that tab's private content or login with a local HTML file.

From `apps/web`:

```sh
node standalone/tx-sim/build-singlefile.mjs --output /tmp/tx-sim-testnet-3.html
```

Open that file and connect through WalletConnect. For Safe-originated requests, connect the Safe and
approve in the Safe web app using desktop MetaMask. Transactions requiring an EOA, including the
prepared Testnet 3 L2 vote, require that exact EOA through a compatible WalletConnect wallet such as
MetaMask Mobile. A Safe does not preserve its owner's address as `msg.sender`. The localhost companion
below remains available for direct desktop MetaMask execution.

The same generated HTML supports direct desktop MetaMask when served over HTTP(S). For example,
serve its directory on loopback with `python3 -m http.server 8766 --bind 127.0.0.1`, then open
`http://127.0.0.1:8766/tx-sim-testnet-3.html`. This requires only static file serving; all chain
reads and transaction preparation remain in the browser. The WalletConnect button is also available.

An imported proposal in Canceled, Defeated or Expired state has **Prepare voting retry**. It reads the
matching source `propose` call, fills the workflow automatically with a new description and L2 ID,
and checks live state. The original receipts remain intact; no wallet request opens until the user
chooses to send. Pending, Active, Succeeded, Queued and Executed proposals do not offer a retry.

To prepare a voting retry of an expired proposal, supply `--retry-description "<new full description>"`
and, if the PR contains several proposals, `--proposal-id <original ID>`. The builder extracts the
original payload from the PR's governor `propose` calldata; the retry must change the L2 proposal ID
while retaining byte-identical L1 message data and upgrade ID. The HTML opens with that workflow
already populated, shows the change, and checks live governance state before any wallet request.
It never sends automatically. The adjacent `.build.json` and `.proposal.json` provide reviewable
source/retry metadata. `--snapshot <downloaded package JSON>` supports an offline rebuild. These
generated files can contain private PR content and must not be committed. Regenerate the HTML to
import subsequent PR updates; an opened file never silently substitutes a different revision.

The primary governance signer flow is the standalone HTML opened directly from disk: connect the
member Safe through WalletConnect for signatures, then a separate mobile executor wallet for calls
that allow any sender. That flow needs no server. See [the standalone build instructions](../ecosystems/README.md).

This optional localhost companion executes reviewed transaction-simulator JSON on Sepolia and ZKsync Testnet 3
(chain 312). It includes arbitrary calls, governance handovers, and normal L2 voting → native L2-to-L1
message proof → `startUpgrade` → final L1 execution. MetaMask receives one request at a time; the signer
reviews and confirms each in the extension. Mainnet transaction files are rejected.

From `apps/web`, after installing workspace dependencies:

```sh
ECOSYSTEM=testnet-3 pnpm exec vite build --config standalone/ecosystems/vite.config.ts
node standalone/inline.mjs standalone/ecosystems/dist-testnet-3 verifier-testnet-3.html
node standalone/tx-sim/setup.mjs
python3 standalone/tx-sim/server.py
```

Open <http://127.0.0.1:8765/> in desktop Chrome with MetaMask. The verifier's **Tx-sim** link opens
<http://127.0.0.1:8765/tx-sim.html>. The server serves an explicit asset allowlist on loopback; it does
not sign, broadcast, or accept private keys. Stop it with Ctrl-C. A single-file verifier opened directly
from disk should use WalletConnect; desktop extension transport needs HTTP(S).

**Refresh from GitHub** uses the existing local `gh` login to read
`matter-labs/transaction-simulator#386`. It pins every changed `transactions/` and `l2-transactions/`
array at one commit, excludes removed files, hashes each input, and rejects a PR head that changes
mid-read. The endpoint accepts only same-origin requests and validated loopback hosts. Credentials
never enter the browser. No private PR snapshot is committed here. You can also open/paste downloaded
JSON files or fetch a raw GitHub URL without the GitHub helper.

Choose a file, review its prerequisites, connect its required account, and switch to the indicated
network. Source outer values are ETH decimals; inner upgrade call values are wei strings. Source fee
caps are preserved. Unsupported networks and fields fail explicitly. `testOnly` and `alreadyExecuted`
entries are excluded; simulation-only balance/batch flags never mutate chain state. Contiguous Safe approvals, distinct owner nominations, and matching token-role grant/renunciation groups can be sent without waiting for each other to mine. Confirm requests one at a time in MetaMask; it manages the nonces. Calls after a group wait for its verified canonical receipts. Unknown operations keep source order. In **Transaction dependencies**, an operator can mark another reviewed call independent of earlier calls for this session; this does not bypass simulation or duplicate/pending request checks. Cross-file and cross-chain runbook
prerequisites remain the operator's responsibility and are explicitly labelled manual confirmations.

The app verifies required receipts with at most four concurrent checks and reports progress. Simulation, balance and fee reads use the configured RPC with a 30-second per-request timeout; MetaMask only supplies the account/network and the signing request. Wallet account/network reads also time out clearly.

The app simulates and estimates the requested call before sending. **It omits `gas` from
`eth_sendTransaction`**, allowing MetaMask to estimate its complete EIP-7702 transaction. A direct-call
estimate is only a preliminary balance check. Review the wallet's final gas and fees before confirming.
The failed Sepolia approval `0xbd964a465cc1899843a3d8531bf3e05ece57e3e9c81beb24b53349a3d35584e1`
exposed this distinction: its wrapper ran out of gas in the Safe. Replaying the original authorization
at the pre-transaction block failed at 413334 gas and succeeded at 700000 gas (`eth_call` only).

Pending or uncertain submissions stay blocked until their receipt or replacement hash is checked.
Progress is stored locally and can be exported. Unchanged calls keep receipt IDs across PR revisions.
Receipt checks verify chain, sender, recipient, value, calldata, fee caps, canonical block and execution
status. Supported MetaMask v1.3 single-call wrappers are decoded against the owner's self-delegation,
reverting execution mode and pinned deployed code at the receipt block. Batches, try-execution,
unsupported enforcers, changed runtime code and mismatched calls remain blocked.

The normal proposal helper accepts the exact upgrade `calls`, `executor`, `salt` and proposal
description, or detects prepared governor `propose` calls from source arrays. Live governor state gates
delegation, propose, vote FOR, queue and execute. Imported governor transaction arrays receive the same live-state checks, decoded from their calldata rather than their source tags. Their panels show the proposal state, opening time and current deadline, and refresh automatically. State reads are pinned to one block; wall-clock time alone never enables a vote. A fresh state check also runs before simulation or submission, including for calls marked independent. The proof helper validates the exact timelock event
and native log, uses the L1 batch transaction index, waits for batch execution, and verifies inclusion
against the chain 312 diamond on L1 before constructing `startUpgrade`. Approval/veto periods still
apply; the verifier handles Council/Guardian approvals. Older Board-based v33 upgrade bundles are
marked superseded for this normal voting workflow.

Tests (no private key or broadcast):

```sh
pnpm test:tx-sim
python3 -m unittest discover -s standalone/tx-sim -p 'test_*.py'
```

The Node tests isolate wallet/RPC boundaries, check exact signing fields, wallet/account/chain failures,
rejection and ambiguous requests, dependency groups, independent submissions with earlier pending calls, replacement receipts, governance states, proof finality,
and real public MetaMask wrapper fixtures. The Python tests check added/removed PR files and moving
heads. ABIs are centralized in `tx-sim-abis.json` (the transaction-simulator governance interfaces) and
`WALLET_ABIS` in `tx-sim-config.mjs`. The local ethers browser build is copied from the pinned package;
no script is loaded from a CDN.
