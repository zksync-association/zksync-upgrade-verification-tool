# Reinforce Freeze / Unfreeze – Manual Anvil Validation Scripts

This document provides step-by-step instructions for manually reproducing
front-running scenarios on a local Anvil / Hardhat node.

## Prerequisites

```bash
# From repo root
pnpm install
cd packages/contracts
pnpm node        # starts Hardhat node on http://localhost:8545
# In a second terminal:
pnpm deploy:setup
cat addresses.txt  # note the deployed addresses
```

Set shell variables from `addresses.txt`:

```bash
export HANDLER=<ProtocolUpgradeHandler address>
export SC=<SecurityCouncil address>
export RPC=http://localhost:8545
export MNEMONIC="test test test test test test test test test test test junk"

# Derive council and attacker addresses (indexes from constants.ts)
# Council member 1 = mnemonic index 0
export COUNCIL1=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 0)
export COUNCIL2=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 4)
export COUNCIL3=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 5)
export ATTACKER=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 3) # visitor
```

---

## Scenario 1 – softFreeze Front-Run

### Step 1: Build the EIP-712 softFreeze digest

```bash
# Get current nonce
NONCE=$(cast call $SC "softFreezeNonce()(uint256)" --rpc-url $RPC)
VALID_UNTIL=$(( $(date +%s) + 3600 ))
CHAIN_ID=$(cast chain-id --rpc-url $RPC)

echo "Nonce: $NONCE, ValidUntil: $VALID_UNTIL, ChainId: $CHAIN_ID"
```

### Step 2: Sign the message (3 council members for soft freeze)

```bash
# EIP-712 typed data signing is easiest via a script; see the test file for
# the full Solidity-equivalent digest construction.
# For testing, we impersonate the SecurityCouncil directly:
cast rpc anvil_impersonateAccount $SC --rpc-url $RPC
cast send $HANDLER "softFreeze()" \
  --from $SC --unlocked --rpc-url $RPC
```

### Step 3: Verify protocol is frozen

```bash
FROZEN_UNTIL=$(cast call $HANDLER "protocolFrozenUntil()(uint256)" --rpc-url $RPC)
echo "Protocol frozen until: $(date -d @$FROZEN_UNTIL)"

STATUS=$(cast call $HANDLER "lastFreezeStatusInUpgradeCycle()(uint8)" --rpc-url $RPC)
echo "Freeze status: $STATUS  (1=Soft, 2=Hard)"
```

### Step 4: Attempt to re-freeze (simulates SC's tx arriving late)

```bash
# This will revert with "Protocol already frozen"
cast send $HANDLER "softFreeze()" \
  --from $SC --unlocked --rpc-url $RPC 2>&1 | grep -E "revert|error"
```

---

## Scenario 2 – Partial Reinforcement (Only Some Chains)

### Step 1: Freeze the protocol

```bash
cast rpc anvil_impersonateAccount $SC --rpc-url $RPC
cast send $HANDLER "softFreeze()" --from $SC --unlocked --rpc-url $RPC
```

### Step 2: Reinforce only chain 324 (zkSync Era)

```bash
# Any address can call reinforceFreezeOneChain
cast send $HANDLER "reinforceFreezeOneChain(uint256)" 324 \
  --from $ATTACKER --unlocked --rpc-url $RPC
```

### Step 3: Check which chains are NOT yet reinforced

```bash
# In the web UI, navigate to /app/reinforce
# It will show chains that have NOT had ReinforceFreezeOneChain emitted

# Via cast – check events from the freeze block:
cast logs --from-block 0 --address $HANDLER \
  "ReinforceFreezeOneChain(uint256)" --rpc-url $RPC
```

### Step 4: Reinforce remaining chains

```bash
# For each chain ID not yet reinforced:
cast send $HANDLER "reinforceFreezeOneChain(uint256)" <CHAIN_ID> \
  --from $ATTACKER --unlocked --rpc-url $RPC
```

---

## Scenario 3 – Emergency Upgrade After Freeze (Chains Remain Frozen)

### Step 1: Hard freeze

```bash
cast rpc anvil_impersonateAccount $SC --rpc-url $RPC
cast send $HANDLER "hardFreeze()" --from $SC --unlocked --rpc-url $RPC
```

### Step 2: Execute emergency upgrade (clears handler state but not chains)

```bash
export EMERGENCY_BOARD=<EmergencyUpgradeBoard address>
cast rpc anvil_impersonateAccount $EMERGENCY_BOARD --rpc-url $RPC

# Build empty proposal calldata
PROPOSAL="([], $EMERGENCY_BOARD, 0x$(openssl rand -hex 32))"
cast send $HANDLER "executeEmergencyUpgrade((address,uint256,bytes)[],address,bytes32)" \
  "[]" $EMERGENCY_BOARD "0x$(openssl rand -hex 32)" \
  --from $EMERGENCY_BOARD --unlocked --rpc-url $RPC
```

### Step 3: Verify handler state cleared but chains still "frozen"

```bash
FROZEN=$(cast call $HANDLER "protocolFrozenUntil()(uint256)" --rpc-url $RPC)
echo "protocolFrozenUntil: $FROZEN  (should be 0)"

STATUS=$(cast call $HANDLER "lastFreezeStatusInUpgradeCycle()(uint8)" --rpc-url $RPC)
echo "lastFreezeStatus: $STATUS  (should be 0=None)"

# In a real deployment, STM chains would still be paused here
```

### Step 4: Reinforce unfreeze

```bash
# reinforceUnfreeze() succeeds when protocolFrozenUntil == 0
cast send $HANDLER "reinforceUnfreeze()" \
  --from $ATTACKER --unlocked --rpc-url $RPC

# Per-chain:
cast send $HANDLER "reinforceUnfreezeOneChain(uint256)" 324 \
  --from $ATTACKER --unlocked --rpc-url $RPC
```

---

## Web UI Validation

1. Start the web app (`cd apps/web && pnpm dev`)
2. Connect with a wallet (any address)
3. Navigate to **Reinforce Freeze / Unfreeze** (`/app/reinforce`)
4. Observe:
   - Protocol freeze status
   - Per-chain reinforcement status
   - "Partial Freeze Detected" warning (if applicable)
5. Click **Reinforce Freeze (All Chains + Bridges)** or individual chain buttons

---

## Notes on `_freeze()` / `_unfreeze()` Being Commented Out

The `_freeze()` and `_unfreeze()` internal functions in `ProtocolUpgradeHandler`
currently have their multi-chain logic commented out with a TODO:

```solidity
// TODO: uncomment when properly deployed an L2 node
// uint256[] memory hyperchainIds = STATE_TRANSITION_MANAGER.getAllHyperchainChainIDs();
// ...
// try STATE_TRANSITION_MANAGER.freezeChain(hyperchainIds[i]) {} catch {}
// try BRIDGE_HUB.pause() {} catch {}
// try SHARED_BRIDGE.pause() {} catch {}
```

This means:
- `softFreeze()`, `hardFreeze()`, `unfreeze()` only update the handler's state
  variables (`protocolFrozenUntil`, `lastFreezeStatusInUpgradeCycle`)
- **No chains or bridges are actually frozen/unfrozen by these calls**
- `reinforceFreezeOneChain(chainId)` DOES work because it calls
  `STATE_TRANSITION_MANAGER.freezeChain(chainId)` directly (not through `_freeze()`)
- After every freeze, ALL chains must be manually reinforced via
  `reinforceFreezeOneChain(chainId)` for each known chain ID

The web UI's Reinforce page accounts for this by listing all chains and
tracking which ones have been reinforced via on-chain events.
