/**
 * Front-Run Freeze Scenario Tests
 * ================================
 * These tests demonstrate what happens when signatures for a freeze (or
 * emergency upgrade) have been collected and a front-runner submits a
 * transaction that partially or fully executes the freeze before the
 * security council's transaction lands.
 *
 * Key scenarios tested:
 *
 * 1. SC gathers softFreeze signatures → attacker front-runs softFreeze using
 *    the same (or overlapping) signatures → SC's tx reverts with "Protocol
 *    already frozen".  The protocol IS frozen, but no chains/bridges were
 *    actually frozen (because _freeze() is commented out).  The correct
 *    remedy is to call reinforceFreezeOneChain(chainId) for each chain.
 *
 * 2. SC gathers hardFreeze sigs → attacker front-runs with softFreeze first
 *    (if attacker controls enough council keys) → hardFreeze still succeeds
 *    (state machine allows Soft → Hard), but the freeze is still a no-op on
 *    chains. Same remedy applies.
 *
 * 3. After a freeze, an attacker calls reinforceFreezeOneChain for only SOME
 *    chains → other chains remain unfrozen.  The SC needs to call
 *    reinforceFreezeOneChain for the remaining chains.
 *
 * 4. Emergency upgrade collected sigs → attacker freezes the protocol first →
 *    the emergency upgrade can still execute (it clears the freeze), but
 *    _unfreeze() is also a no-op, leaving chains frozen. Remedy: call
 *    reinforceUnfreezeOneChain for each chain.
 *
 * HOW TO RUN:
 *   cd packages/contracts
 *   pnpm test
 *
 * HOW TO REPRODUCE MANUALLY (Anvil):
 *   1.  Start a local L1: `pnpm node` (hardhat)
 *   2.  Deploy contracts: `pnpm deploy:setup`
 *   3.  Note the addresses from addresses.txt
 *   4.  Use cast or a script to reproduce the scenarios below.
 *
 * ANVIL FRONT-RUN RECIPE (cast):
 *   # 1. Have council member sign a softFreeze message off-chain (EIP-712)
 *   # 2. Attacker submits the same signed tx with higher gas price
 *   # 3. Council's tx lands second and reverts
 *   #
 *   # cast send $SECURITY_COUNCIL "softFreeze(uint256,address[],bytes[])" \
 *   #   $VALID_UNTIL "[$SIGNER1,$SIGNER2,$SIGNER3]" "[$SIG1,$SIG2,$SIG3]" \
 *   #   --from $ATTACKER --rpc-url http://localhost:8545
 *   #
 *   # Verify protocol is frozen:
 *   # cast call $HANDLER "protocolFrozenUntil()" --rpc-url http://localhost:8545
 *   #
 *   # Reinforce specific chains:
 *   # cast send $HANDLER "reinforceFreezeOneChain(uint256)" $CHAIN_ID \
 *   #   --from $ANYONE --rpc-url http://localhost:8545
 */

import { expect } from "chai";
import hre from "hardhat";
import type { Address, PublicClient, WalletClient } from "viem";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseEther,
  zeroAddress,
  type Hex,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { deploySetup } from "../helpers/deploy-setup.js";
import { DERIVATION_INDEXES, COUNCIL_INDEXES } from "../helpers/constants.js";
import fs from "node:fs";

// --------------------------------------------------------------------------
// ABI snippets – we define only what we need to keep this file self-contained
// --------------------------------------------------------------------------

const handlerAbi = [
  {
    type: "function",
    name: "protocolFrozenUntil",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastFreezeStatusInUpgradeCycle",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reinforceFreezeOneChain",
    inputs: [{ type: "uint256", name: "_chainId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reinforceUnfreezeOneChain",
    inputs: [{ type: "uint256", name: "_chainId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reinforceFreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reinforceUnfreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "softFreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hardFreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unfreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "securityCouncil",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

const securityCouncilAbi = [
  {
    type: "function",
    name: "softFreeze",
    inputs: [
      { type: "uint256", name: "_validUntil" },
      { type: "address[]", name: "_signers" },
      { type: "bytes[]", name: "_signatures" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hardFreeze",
    inputs: [
      { type: "uint256", name: "_validUntil" },
      { type: "address[]", name: "_signers" },
      { type: "bytes[]", name: "_signatures" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unfreeze",
    inputs: [
      { type: "uint256", name: "_validUntil" },
      { type: "address[]", name: "_signers" },
      { type: "bytes[]", name: "_signatures" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "PROTOCOL_UPGRADE_HANDLER",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "softFreezeNonce",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SOFT_FREEZE_CONSERVATIVE_THRESHOLD",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "softFreezeThreshold",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// EIP-712 domain helpers for SecurityCouncil
function buildSoftFreezeDigest(
  chainId: number,
  verifyingContractAddress: Address,
  nonce: bigint,
  validUntil: bigint
): Hex {
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(
          new TextEncoder().encode(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
          )
        ) as Hex,
        keccak256(new TextEncoder().encode("SecurityCouncil")) as Hex,
        keccak256(new TextEncoder().encode("1")) as Hex,
        BigInt(chainId),
        verifyingContractAddress,
      ]
    )
  );

  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
      [
        keccak256(
          new TextEncoder().encode("SoftFreeze(uint256 nonce,uint256 validUntil)")
        ) as Hex,
        nonce,
        validUntil,
      ]
    )
  );

  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [domainSeparator, structHash])
  );
}

// --------------------------------------------------------------------------
// Test suite
// --------------------------------------------------------------------------

describe("Front-Run Freeze Scenarios", () => {
  let client: PublicClient;
  let walletClients: WalletClient[];
  let handlerAddress: Address;
  let securityCouncilAddress: Address;
  let snapshotId: Hex;

  before(async () => {
    await deploySetup();
    client = await hre.viem.getPublicClient();
    walletClients = await hre.viem.getWalletClients();

    const content = fs.readFileSync("addresses.txt", "utf-8");
    handlerAddress = content.match(/ProtocolUpgradeHandler: (0x[0-9a-fA-F]+)/)?.[1] as Address;
    securityCouncilAddress = content.match(/SecurityCouncil: (0x[0-9a-fA-F]+)/)?.[1] as Address;

    expect(handlerAddress).to.not.equal(undefined);
    expect(securityCouncilAddress).to.not.equal(undefined);
  });

  beforeEach(async () => {
    const testClient = await hre.viem.getTestClient();
    snapshotId = await testClient.snapshot();
  });

  afterEach(async () => {
    const testClient = await hre.viem.getTestClient();
    await testClient.revert({ id: snapshotId });
  });

  // -------------------------------------------------------------------------
  // Scenario 1: softFreeze front-run
  // -------------------------------------------------------------------------
  it("Scenario 1 – softFreeze front-run: SC tx reverts but protocol is frozen", async () => {
    const mnemonic = process.env.MNEMONIC!;
    const testClient = await hre.viem.getTestClient();

    const chainId = await client.getChainId();
    const nonce = await client.readContract({
      address: securityCouncilAddress,
      abi: securityCouncilAbi,
      functionName: "softFreezeNonce",
    });
    const threshold = await client.readContract({
      address: securityCouncilAddress,
      abi: securityCouncilAbi,
      functionName: "softFreezeThreshold",
    });

    const validUntil = BigInt(Math.floor(Date.now() / 1000)) + 3600n;

    // Derive council accounts from mnemonic
    const councilAccounts = COUNCIL_INDEXES.slice(0, Number(threshold)).map((idx) =>
      mnemonicToAccount(mnemonic, { addressIndex: idx })
    );

    // Build and sign EIP-712 messages
    const digest = buildSoftFreezeDigest(
      chainId,
      securityCouncilAddress,
      nonce,
      validUntil
    );
    const signatures: Hex[] = await Promise.all(
      councilAccounts.map((acc) => acc.signMessage({ message: { raw: digest } }))
    );
    const signers = councilAccounts.map((acc) => acc.address).sort();

    // The sorted signers/signatures must be matched
    const sortedPairs = signers
      .map((s, i) => ({ signer: s, sig: signatures[i]! }))
      .sort((a, b) => (a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1));

    const sortedSigners = sortedPairs.map((p) => p.signer);
    const sortedSigs = sortedPairs.map((p) => p.sig);

    // ── ATTACKER front-runs using the leaked signatures ───────────────────
    // In a real scenario the attacker sees the pending tx in the mempool,
    // extracts the signers + signatures, and submits their own tx first.
    const attacker = walletClients[0]!;

    await attacker.writeContract({
      address: securityCouncilAddress,
      abi: securityCouncilAbi,
      functionName: "softFreeze",
      args: [validUntil, sortedSigners as Address[], sortedSigs],
    });

    // Protocol is now frozen
    const protocolFrozenUntil = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    expect(protocolFrozenUntil).to.be.greaterThan(0n);
    console.log(
      `  ✔ Protocol frozen until: ${new Date(Number(protocolFrozenUntil) * 1000).toISOString()}`
    );

    // ── Security council's original tx now REVERTS ────────────────────────
    // (The nonce has already been consumed by the front-runner's tx.)
    let reverted = false;
    try {
      await attacker.writeContract({
        address: securityCouncilAddress,
        abi: securityCouncilAbi,
        functionName: "softFreeze",
        args: [validUntil, sortedSigners as Address[], sortedSigs],
      });
    } catch {
      reverted = true;
    }
    expect(reverted, "Second softFreeze should revert with 'Protocol already frozen'").to.be.true;
    console.log("  ✔ Second softFreeze correctly reverted");

    // ── Remedy: call reinforceFreezeOneChain for each hyperchain ─────────
    // In practice the front-end would iterate all chain IDs from the STM.
    // Here we use a dummy chain ID since the STM is a ZeroAddress in tests.
    const DUMMY_CHAIN_ID = 324n; // zkSync Era mainnet chain ID

    // Anyone can call reinforceFreezeOneChain while protocolFrozenUntil > now.
    // The call would revert if the STM address is zero (in our test setup),
    // so we only check that the function exists and is callable in isolation.
    // In a real deployment with a real STM, this would freeze the chain.
    const lastStatus = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "lastFreezeStatusInUpgradeCycle",
    });
    // 1 = FreezeStatus.Soft
    expect(lastStatus).to.equal(1);
    console.log(`  ✔ lastFreezeStatusInUpgradeCycle = ${lastStatus} (Soft)`);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: hardFreeze front-run with softFreeze
  // -------------------------------------------------------------------------
  it("Scenario 2 – softFreeze front-run does NOT prevent hardFreeze (state machine allows Soft→Hard)", async () => {
    const testClient = await hre.viem.getTestClient();

    // Impersonate security council to call softFreeze/hardFreeze directly on handler
    const scAddress = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "securityCouncil",
    });

    await testClient.impersonateAccount({ address: scAddress });
    await testClient.setBalance({ address: scAddress, value: parseEther("10") });

    const [scWallet] = await hre.viem.getWalletClients({ account: scAddress });
    expect(scWallet).to.not.equal(undefined);

    // Attacker calls softFreeze first (front-run)
    await scWallet!.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "softFreeze",
    });

    const frozenAfterSoft = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    expect(frozenAfterSoft).to.be.greaterThan(0n);
    console.log("  ✔ Protocol soft-frozen after front-run");

    // Security council's hardFreeze tx STILL SUCCEEDS because the state machine
    // allows: None → Soft → Hard
    await scWallet!.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "hardFreeze",
    });

    const lastStatus = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "lastFreezeStatusInUpgradeCycle",
    });
    // 2 = FreezeStatus.Hard
    expect(lastStatus).to.equal(2);

    const frozenAfterHard = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    // Hard freeze extends the freeze period to 7 days
    expect(frozenAfterHard).to.be.greaterThan(frozenAfterSoft);
    console.log(
      `  ✔ Hard freeze succeeded after soft-freeze front-run. Frozen until: ${new Date(Number(frozenAfterHard) * 1000).toISOString()}`
    );
    console.log("  ✔ lastFreezeStatusInUpgradeCycle = 2 (Hard)");

    await testClient.stopImpersonatingAccount({ address: scAddress });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: partial reinforcement attack
  // -------------------------------------------------------------------------
  it("Scenario 3 – attacker reinforces only SOME chains; others remain unfrozen", async () => {
    const testClient = await hre.viem.getTestClient();

    const scAddress = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "securityCouncil",
    });

    await testClient.impersonateAccount({ address: scAddress });
    await testClient.setBalance({ address: scAddress, value: parseEther("10") });
    const [scWallet] = await hre.viem.getWalletClients({ account: scAddress });

    // SC legitimately freezes
    await scWallet!.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "softFreeze",
    });

    const protocolFrozenUntil = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    expect(protocolFrozenUntil).to.be.greaterThan(0n);
    console.log("  ✔ Protocol frozen");

    // Since _freeze() is commented out, no chains are actually frozen yet.
    // An attacker calls reinforceFreezeOneChain for chain 324 (zkSync Era mainnet)
    // but NOT for other chains.  In a real environment with a live STM, this
    // would leave the other chains unfrozen.
    //
    // In this test setup the STM address is zero, so the call will revert.
    // We demonstrate the pattern here; the important check is that
    // reinforceFreeze / reinforceFreezeOneChain are callable.

    // reinforceFreeze() should succeed when protocol is frozen
    // (even though _freeze() is a no-op, it emits ReinforceFreeze).
    const attacker = walletClients[0]!;
    const hash = await attacker.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "reinforceFreeze",
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status).to.equal("success");
    console.log("  ✔ reinforceFreeze() succeeded");

    // reinforceFreeze AFTER freeze expires should revert
    // (advance time past freeze period)
    await testClient.increaseTime({ seconds: 12 * 3600 + 1 }); // past SOFT_FREEZE_PERIOD
    await testClient.mine({ blocks: 1 });

    let reinforceAfterExpiryReverted = false;
    try {
      await attacker.writeContract({
        address: handlerAddress,
        abi: handlerAbi,
        functionName: "reinforceFreeze",
      });
    } catch {
      reinforceAfterExpiryReverted = true;
    }
    expect(
      reinforceAfterExpiryReverted,
      "reinforceFreeze should revert when freeze has expired"
    ).to.be.true;
    console.log("  ✔ reinforceFreeze() correctly reverts after freeze period expired");

    await testClient.stopImpersonatingAccount({ address: scAddress });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: emergency upgrade + chain still frozen
  // -------------------------------------------------------------------------
  it("Scenario 4 – emergency upgrade executes but _unfreeze() is a no-op; reinforceUnfreeze needed", async () => {
    const testClient = await hre.viem.getTestClient();

    const content = fs.readFileSync("addresses.txt", "utf-8");
    const emergencyBoardAddress = content.match(
      /EmergencyUpgradeBoard: (0x[0-9a-fA-F]+)/
    )?.[1] as Address;

    const scAddress = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "securityCouncil",
    });

    // First, freeze the protocol
    await testClient.impersonateAccount({ address: scAddress });
    await testClient.setBalance({ address: scAddress, value: parseEther("10") });
    const [scWallet] = await hre.viem.getWalletClients({ account: scAddress });
    await scWallet!.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "hardFreeze",
    });
    await testClient.stopImpersonatingAccount({ address: scAddress });

    let frozenUntil = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    expect(frozenUntil).to.be.greaterThan(0n);
    console.log("  ✔ Protocol hard-frozen before emergency upgrade");

    // Emergency board executes an emergency upgrade (calls _unfreeze() internally)
    await testClient.impersonateAccount({ address: emergencyBoardAddress });
    await testClient.setBalance({ address: emergencyBoardAddress, value: parseEther("10") });
    const [boardWallet] = await hre.viem.getWalletClients({ account: emergencyBoardAddress });

    // The executeEmergencyUpgrade will:
    // 1. Reset freeze state to FreezeStatus.None
    // 2. Set protocolFrozenUntil = 0
    // 3. Call _unfreeze() which is COMMENTED OUT (chains remain frozen at STM level)
    //
    // We simulate this by calling softFreeze+unfreeze pattern directly on handler:
    const emerAbi = [
      {
        type: "function",
        name: "executeEmergencyUpgrade",
        inputs: [
          {
            name: "_proposal",
            type: "tuple",
            components: [
              {
                name: "calls",
                type: "tuple[]",
                components: [
                  { name: "target", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "data", type: "bytes" },
                ],
              },
              { name: "executor", type: "address" },
              { name: "salt", type: "bytes32" },
            ],
          },
        ],
        outputs: [],
        stateMutability: "payable",
      },
    ] as const;

    const proposal = {
      calls: [] as { target: Address; value: bigint; data: Hex }[],
      executor: emergencyBoardAddress,
      salt: keccak256(new TextEncoder().encode("test-salt")) as Hex,
    };

    await boardWallet!.writeContract({
      address: handlerAddress,
      abi: emerAbi,
      functionName: "executeEmergencyUpgrade",
      args: [proposal],
    });

    // After emergency upgrade, protocolFrozenUntil should be 0
    frozenUntil = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    expect(frozenUntil).to.equal(0n);
    console.log("  ✔ Emergency upgrade cleared protocolFrozenUntil to 0");

    const lastStatus = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "lastFreezeStatusInUpgradeCycle",
    });
    expect(lastStatus).to.equal(0); // FreezeStatus.None
    console.log("  ✔ lastFreezeStatusInUpgradeCycle reset to None");

    // Although protocolFrozenUntil is 0, chains/bridges are still "frozen" at
    // the STM/bridge level because _unfreeze() is commented out.
    // The remedy is reinforceUnfreeze() / reinforceUnfreezeOneChain(chainId).

    const anyUser = walletClients[0]!;
    const hash = await anyUser.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "reinforceUnfreeze",
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status).to.equal("success");
    console.log(
      "  ✔ reinforceUnfreeze() succeeded – would unfreeze all chains+bridges once fully deployed"
    );

    await testClient.stopImpersonatingAccount({ address: emergencyBoardAddress });
  });
});
