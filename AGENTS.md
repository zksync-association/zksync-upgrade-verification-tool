# AGENTS.md

How to run this app for a ZKsync governance signer, verify a proposal with it, and run its tests. Read the rules first.

## Rules

- Read-only on mainnet. Never sign, never send a transaction, never POST to the Safe Transaction Service. Signing is
  the signer's own action in their Safe; the app only reads.
- Report hashes and addresses in full. A signer compares them character by character with their hardware wallet.
- Never rely on Safe's API alone. A signature counts only when `status` is `"valid"`, which means the governance
  contract accepted it in an `eth_call`.
- Stop and report if `governance.warnings` is non-empty, `governance.network.overrides` is non-empty, or
  `logHistory.status` is not `"ok"`. These mean the contracts disagree, a trust anchor was replaced, or proposal lists
  may be incomplete.

## Run

Needs Node.js 20+, plus an Ethereum mainnet or Sepolia RPC with log history. Use the signer's own
RPC, or `https://mainnet.gateway.tenderly.co` / `https://sepolia.gateway.tenderly.co`.

```bash
L1_RPC_URL=<rpc> npm start          # repo root: install, build, serve on http://localhost:3000
curl -s localhost:3000/api/status | jq '{ok, chain: .governance.network.label, warnings: .governance.warnings, overrides: .governance.network.overrides, logHistory}'
```

The first load of a page takes up to about 15 s. Without a Safe API key, Safe allows 2 requests/s, and every result
is cached for a minute.

## Verify

Every page has a JSON twin. Both run the same code.

| What | Page | JSON |
| --- | --- | --- |
| Status, roles, thresholds | `/` | `GET /api/status` |
| Protocol upgrades | `/app/proposals` | `GET /api/upgrades` (`?history=all` for everything since deployment) |
| One upgrade | `/app/proposals/<id>` | `GET /api/upgrades/<id>` |
| Emergency upgrades | `/app/emergency/<id>` | `GET /api/emergency/<id>`; `POST` the payload JSON to the same URL to check it against the id |
| Freeze request | `/app/freeze/<soft-freeze\|hard-freeze\|unfreeze\|set-soft-freeze-threshold>?nonce=&validUntil=[&threshold=]` | same path under `/api/freeze/` |
| Guardian veto | `/app/l2-cancellations/<l2ProposalId>?governor=&l2GasLimit=&l2GasPerPubdataByteLimit=&refundRecipient=&txMintValue=&nonce=` | same path under `/api/vetoes/` |

Example: check upgrade `0x77d5…eaaa`. On mainnet today it is executed. The Security Council approved it in tx `0x1defa4f7…` with 6 of the 7 signatures in Safe.

```bash
ID=0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa
curl -s localhost:3000/api/upgrades/$ID | jq '{
  state: .stateLabel, idMatches: .started.idMatches, calls: .started.proposal.calls,
  sets: [.sets[] | {key, state: .state.status, threshold: .set.threshold, valid: (.set.valid|length),
          thresholdCheck: .set.thresholdCheck.status,
          members: [.set.members[] | {label, member, status, source}],
          used: [.used[]? | {signer, matchesSafe}], historical}]}'
```

What the fields mean:

- `started.idMatches`: `keccak256(abi.encode(calls, executor, salt))` equals the id. The calls are what will run.
- `sets[].set.typedData` / `.hashes.digest`: the exact EIP-712 data members sign. The domain is read from the
  contract's `eip712Domain()`.
- `sets[].set.members[].hashes`: per member Safe, the `domainHash` and `messageHash` a hardware wallet shows, and the
  `safeMessageHash` it signs (also Safe{Wallet}'s id for the message).
- `members[].status`:
  - `valid`: accepted by `checkSignatures` (or the Safe's `isValidSignature`).
  - `collecting`: the Safe has fewer owner signatures than its threshold.
  - `invalid`: rejected; `error` holds the revert.
  - `missing`: no signature.
  - `unavailable`: Safe's API failed. On-chain approvals are still checked.
- `set.thresholdCheck.status = "met"`: the contract accepted the whole sorted set at its on-chain threshold.
- `execution`: `to`, `data` and `value` to send, plus `simulation` (an `eth_call` on the latest block). Anyone can send it.
- For completed actions:
  - `used[].matchesSafe`: the signatures the transaction carried are byte-identical to Safe's copies.
  - `historical.accepted`: the contract accepts them at the block before execution (needs an archive RPC).

Emergency upgrades sign only the id. Before execution the calls and salt must come from the proposer:

```bash
curl -s -X POST localhost:3000/api/emergency/<id> -H 'content-type: application/json' -d @payload.json | jq '.check'
```

Payload format: `{"salt":"0x…","calls":[{"target":"0x…","value":"0","data":"0x…"}]}`. An `executor` field is
optional; if present it must be the Emergency Upgrade Board. Once executed, `GET` returns `executed.proposal`, rebuilt
from the execution calldata, with `idMatches`.

A signature held outside Safe can be checked by adding `?sig=<memberSafe>:<signatureHex>` (repeatable) to any page or
JSON URL. It is verified on-chain like the others and stored nowhere.

## Test

On Node 25+, which no longer bundles corepack, use `npx pnpm@9.7.1` where these say `corepack pnpm`.

```bash
corepack pnpm install
corepack pnpm check && corepack pnpm typecheck            # lint + types (all packages)
corepack pnpm test                                        # hermetic: web unit/server tests, CLI tests
cd apps/web && corepack pnpm test:i                       # mainnet, read-only: the brief's evidence (Tenderly + Safe API)
cd apps/web && corepack pnpm test:fork                    # write paths on an anvil fork (needs `anvil`; FORK_URL to override)
corepack pnpm --filter web build && cd packages/e2e && corepack pnpm test:web   # Playwright on the fork (PW_CHANNEL=chrome to use local Chrome)
```

Test data recorded from mainnet lives in `apps/web/test/fixtures` (re-record with
`apps/web/test/support/record-fixtures.ts`). The fork tests make a public anvil test key an owner of member Safes,
on the local fork only, and serve its signatures from a local mock of the Safe API (`apps/web/test/support`).

## Map

- `apps/web/app/.server/`: chain and Safe access, log scanning, the verification engine (`signatures.ts`), and one
  module per flow (`flows/`).
- `apps/web/app/common/`: shared with the browser: ABIs, EIP-712 types, Safe hashes, calldata builders, pinned
  network addresses (`networks.ts`).
- `apps/web/app/routes/`: pages (`app/…`) and the JSON API (`api+/…`).
- `apps/cli/`: upgrade verification CLI. Each upgrade page offers its upgrade file.
- `packages/e2e/`: Playwright suite for the web app (`suites/web`) and CLI e2e (`suites/cli`).
