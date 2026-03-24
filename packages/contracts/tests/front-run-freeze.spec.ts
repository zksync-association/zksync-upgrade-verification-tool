/**
 * Front-Run Freeze Scenario Tests
 * ================================
 * These tests run AFTER deploy-all.spec.ts has already called deploySetup()
 * and written addresses.txt.  Hardhat runs all test files on the same
 * in-process node, so we just read the addresses written by the earlier suite.
 *
 * HOW TO RUN (requires compiled contracts — see README):
 *   cd packages/contracts
 *   pnpm node          # terminal 1: hardhat node
 *   pnpm deploy:setup  # terminal 2: deploy contracts → writes addresses.txt
 *   pnpm test          # terminal 2: runs all tests
 *
 * HOW TO REPRODUCE MANUALLY (cast):
 *   See REINFORCE_FREEZE_SCRIPTS.md
 *
 * WHAT THESE TESTS VERIFY (not a live browser test):
 *   1. softFreeze front-run: second identical tx reverts; protocol still frozen
 *   2. Soft→Hard: a softFreeze front-run does NOT prevent a hardFreeze
 *   3. reinforceFreeze() works while frozen, reverts after expiry
 *   4. Emergency upgrade clears protocolFrozenUntil; reinforceUnfreeze() works after
 *
 * NOTE ON BROWSER VALIDATION:
 *   These tests only verify on-chain state via Hardhat. To see the UI response
 *   (warning banners, reinforce page) you need the full local setup described in
 *   REINFORCE_FREEZE_SCRIPTS.md — running a Hardhat node, the web app, and
 *   triggering freeze transactions via cast.
 */

import { expect } from "chai";
import hre from "hardhat";
import fs from "node:fs";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { keccak256, parseEther } from "viem";

// --------------------------------------------------------------------------
// Minimal ABIs – only what these tests need
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

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function getAddresses(): Record<string, Address> {
  const content = fs.readFileSync("addresses.txt", "utf-8");
  const result: Record<string, Address> = {};
  for (const line of content.split("\n")) {
    const [key, value] = line.split(":");
    if (key && value) {
      result[key.trim()] = value.trim() as Address;
    }
  }
  return result;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("Front-Run Freeze Scenarios", () => {
  let client: PublicClient;
  let walletClients: WalletClient[];
  let handlerAddress: Address;
  let securityCouncilAddress: Address;
  let emergencyBoardAddress: Address;
  let snapshotId: Hex;

  before(async () => {
    // Addresses were written by deploy-all.spec.ts which runs first (alphabetically)
    const addresses = getAddresses();
    handlerAddress = addresses["ProtocolUpgradeHandler"]!;
    securityCouncilAddress = addresses["SecurityCouncil"]!;
    emergencyBoardAddress = addresses["EmergencyUpgradeBoard"]!;

    expect(handlerAddress, "ProtocolUpgradeHandler address missing from addresses.txt").to.not
      .be.undefined;
    expect(securityCouncilAddress, "SecurityCouncil address missing").to.not.be.undefined;
    expect(emergencyBoardAddress, "EmergencyUpgradeBoard address missing").to.not.be.undefined;

    client = await hre.viem.getPublicClient();
    walletClients = await hre.viem.getWalletClients();
  });

  beforeEach(async () => {
    // Snapshot state so each test starts from the same baseline
    const testClient = await hre.viem.getTestClient();
    snapshotId = await testClient.snapshot();
  });

  afterEach(async () => {
    const testClient = await hre.viem.getTestClient();
    await testClient.revert({ id: snapshotId });
  });

  // -------------------------------------------------------------------------
  // Scenario 1: softFreeze front-run
  //
  // What happens: SC has valid signatures; attacker broadcasts the identical tx
  // first (or simply calls softFreeze via impersonation here).  SC's tx reverts.
  // The protocol IS frozen but NO chains/bridges were actually frozen because
  // _freeze() is commented out.
  // -------------------------------------------------------------------------
  it("Scenario 1 – softFreeze front-run: SC tx reverts; protocol is frozen; status = Soft", async () => {
    const testClient = await hre.viem.getTestClient();
    const anyWallet = walletClients[0]!;

    // Impersonate SecurityCouncil to call softFreeze directly on the handler
    // (simulates the attacker executing first via the SC contract)
    const scAddress = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "securityCouncil",
    });
    await testClient.impersonateAccount({ address: scAddress });
    await testClient.setBalance({ address: scAddress, value: parseEther("10") });
    const [scWallet] = await hre.viem.getWalletClients({ account: scAddress });

    // ── Attacker (impersonated as SC) calls softFreeze first ──────────────
    await scWallet!.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "softFreeze",
    });

    const frozenUntil = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    expect(frozenUntil, "Protocol should be frozen").to.be.greaterThan(0n);
    console.log(
      `    protocolFrozenUntil = ${new Date(Number(frozenUntil) * 1000).toISOString()}`
    );

    // ── Security council's tx arrives second – must revert ────────────────
    let reverted = false;
    try {
      await scWallet!.writeContract({
        address: handlerAddress,
        abi: handlerAbi,
        functionName: "softFreeze",
      });
    } catch {
      reverted = true;
    }
    expect(reverted, "Second softFreeze should revert (Protocol already frozen)").to.be.true;

    const status = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "lastFreezeStatusInUpgradeCycle",
    });
    expect(status, "Should be FreezeStatus.Soft (1)").to.equal(1);
    console.log(`    lastFreezeStatusInUpgradeCycle = ${status} (1 = Soft)`);

    // ── Remedy: reinforceFreeze() succeeds (callable by anyone while frozen) ─
    const reinforceHash = await anyWallet.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "reinforceFreeze",
    });
    const receipt = await client.waitForTransactionReceipt({ hash: reinforceHash });
    expect(receipt.status, "reinforceFreeze should succeed").to.equal("success");
    console.log("    reinforceFreeze() succeeded – emitted ReinforceFreeze event");

    await testClient.stopImpersonatingAccount({ address: scAddress });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: soft-freeze front-run does NOT prevent hardFreeze
  //
  // State machine allows: None → Soft → Hard
  // So even if an attacker front-ran with softFreeze, the SC's hardFreeze
  // still succeeds and extends the freeze to 7 days.
  // -------------------------------------------------------------------------
  it("Scenario 2 – softFreeze front-run does NOT block hardFreeze (Soft → Hard allowed)", async () => {
    const testClient = await hre.viem.getTestClient();

    const scAddress = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "securityCouncil",
    });
    await testClient.impersonateAccount({ address: scAddress });
    await testClient.setBalance({ address: scAddress, value: parseEther("10") });
    const [scWallet] = await hre.viem.getWalletClients({ account: scAddress });

    // Attacker front-runs with softFreeze
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
    console.log(
      `    After softFreeze front-run: frozenUntil = ${new Date(Number(frozenAfterSoft) * 1000).toISOString()}`
    );

    // SC's hardFreeze tx – state machine allows Soft → Hard, so this succeeds
    await scWallet!.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "hardFreeze",
    });

    const status = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "lastFreezeStatusInUpgradeCycle",
    });
    expect(status, "Should be FreezeStatus.Hard (2)").to.equal(2);

    const frozenAfterHard = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    // Hard freeze (7 days) extends past soft freeze (12 hours)
    expect(frozenAfterHard, "Hard freeze should extend the frozen period").to.be.greaterThan(
      frozenAfterSoft
    );
    console.log(
      `    After hardFreeze: frozenUntil = ${new Date(Number(frozenAfterHard) * 1000).toISOString()}`
    );
    console.log(`    lastFreezeStatusInUpgradeCycle = ${status} (2 = Hard)`);

    await testClient.stopImpersonatingAccount({ address: scAddress });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: reinforceFreeze() works while frozen; reverts after expiry
  //
  // Demonstrates that reinforceFreeze is callable by ANYONE while
  // block.timestamp <= protocolFrozenUntil, and correctly reverts after the
  // freeze expires.
  // -------------------------------------------------------------------------
  it("Scenario 3 – reinforceFreeze() succeeds while frozen; reverts after freeze expires", async () => {
    const testClient = await hre.viem.getTestClient();
    const anyWallet = walletClients[0]!;

    const scAddress = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "securityCouncil",
    });
    await testClient.impersonateAccount({ address: scAddress });
    await testClient.setBalance({ address: scAddress, value: parseEther("10") });
    const [scWallet] = await hre.viem.getWalletClients({ account: scAddress });

    await scWallet!.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "softFreeze",
    });
    await testClient.stopImpersonatingAccount({ address: scAddress });

    // reinforceFreeze works while frozen
    const hash = await anyWallet.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "reinforceFreeze",
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status).to.equal("success");
    console.log("    reinforceFreeze() succeeded while frozen");

    // Advance time past SOFT_FREEZE_PERIOD (12 hours)
    await testClient.increaseTime({ seconds: 12 * 3600 + 1 });
    await testClient.mine({ blocks: 1 });

    // reinforceFreeze should now revert (freeze period expired)
    let reverted = false;
    try {
      await anyWallet.writeContract({
        address: handlerAddress,
        abi: handlerAbi,
        functionName: "reinforceFreeze",
      });
    } catch {
      reverted = true;
    }
    expect(reverted, "reinforceFreeze should revert after freeze expired").to.be.true;
    console.log("    reinforceFreeze() correctly reverted after freeze period expired");
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Emergency upgrade clears handler state; reinforceUnfreeze needed
  //
  // executeEmergencyUpgrade resets protocolFrozenUntil to 0 and calls
  // _unfreeze() — but _unfreeze() is currently commented out, so chains remain
  // frozen at the STM level.  reinforceUnfreeze() is the remedy.
  // -------------------------------------------------------------------------
  it("Scenario 4 – emergency upgrade clears freeze; reinforceUnfreeze() works after", async () => {
    const testClient = await hre.viem.getTestClient();
    const anyWallet = walletClients[0]!;

    // First hard-freeze the protocol
    const scAddress = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "securityCouncil",
    });
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
    console.log("    Protocol hard-frozen before emergency upgrade");

    // Execute emergency upgrade via EmergencyUpgradeBoard
    await testClient.impersonateAccount({ address: emergencyBoardAddress });
    await testClient.setBalance({ address: emergencyBoardAddress, value: parseEther("10") });
    const [boardWallet] = await hre.viem.getWalletClients({ account: emergencyBoardAddress });

    const proposal = {
      calls: [] as { target: Address; value: bigint; data: Hex }[],
      executor: emergencyBoardAddress,
      salt: keccak256(new TextEncoder().encode("test-upgrade-salt")) as Hex,
    };

    await boardWallet!.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "executeEmergencyUpgrade",
      args: [proposal],
    });
    await testClient.stopImpersonatingAccount({ address: emergencyBoardAddress });

    // Handler state is cleared
    frozenUntil = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "protocolFrozenUntil",
    });
    expect(frozenUntil, "protocolFrozenUntil should be 0 after emergency upgrade").to.equal(0n);

    const status = await client.readContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "lastFreezeStatusInUpgradeCycle",
    });
    expect(status, "lastFreezeStatus should be None (0) after emergency upgrade").to.equal(0);
    console.log("    Emergency upgrade cleared protocolFrozenUntil = 0, status = None (0)");

    // Although handler says "not frozen", chains/bridges at STM/bridge level
    // may still be paused (because _unfreeze() is a TODO no-op).
    // reinforceUnfreeze() is callable when protocolFrozenUntil == 0.
    const reinforceHash = await anyWallet.writeContract({
      address: handlerAddress,
      abi: handlerAbi,
      functionName: "reinforceUnfreeze",
    });
    const receipt = await client.waitForTransactionReceipt({ hash: reinforceHash });
    expect(receipt.status, "reinforceUnfreeze should succeed").to.equal("success");
    console.log(
      "    reinforceUnfreeze() succeeded – would unfreeze all chains+bridges when _unfreeze() is fully deployed"
    );
  });
});
