import {
  ERC1271_MAGIC_VALUE,
  emergencyUpgradeBoardAbi,
  safeAbi,
  upgradeHandlerAbi,
} from "@/common/abis";
import { type MemberSignature, encodeMultisigSignature } from "@/common/execution";
import {
  type DecodedCall,
  type UpgradeProposal,
  decodeCall,
  upgradeProposalId,
} from "@/common/proposal";
import { type ActionName, buildTypedData } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Address, type Hex, decodeAbiParameters, decodeFunctionData, getAddress } from "viem";
import { cached } from "../cache";
import { type Governance, governance } from "../governance";
import { getLogs } from "../logs";
import { l1, network } from "../rpc";
import { type SignatureSet, isRevert, revertReason, verifySignatureSet } from "../signatures";
import {
  type UsedSignature,
  callTo,
  compareUsedSignatures,
  hasArchiveState,
  topicOf,
} from "./common";
import { collectMessages } from "./messages";

// Emergency upgrades sign only the id = keccak256(abi.encode(calls, executor, salt)); Safe never
// sees the calls or salt. Before execution they must come from the proposer (a payload file the
// browser checks against the id, client-side). After execution they are rebuilt from the calldata.

const EMERGENCY_ACTIONS = [
  "ExecuteEmergencyUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeGuardians",
  "ExecuteEmergencyUpgradeZKFoundation",
] as const satisfies readonly ActionName[];

type Executed = { id: Hex; txHash: Hex; blockNumber: bigint };

/** Every EmergencyUpgradeExecuted event since the handler was deployed (cached per range). */
async function executedEmergencies(): Promise<Executed[]> {
  const net = await network();
  const logs = await getLogs(
    l1,
    {
      address: net.upgradeHandler,
      topics: [topicOf(upgradeHandlerAbi, "EmergencyUpgradeExecuted")],
    },
    net.upgradeHandlerDeployBlock
  );
  return logs.map((log) => ({
    id: log.topics[1] as Hex,
    txHash: log.transactionHash as Hex,
    blockNumber: log.blockNumber ?? 0n,
  }));
}

export type EmergencySummary = {
  id: Hex;
  executed: { txHash: Hex; blockNumber: string } | null;
  reported: { securityCouncil: number; guardians: number; zkFoundation: boolean };
  firstSeen: string | null;
};

export async function listEmergencyUpgrades() {
  const gov = await governance();
  const board = gov.emergencyUpgradeBoard;
  const [collected, executed] = await Promise.all([
    collectMessages(
      [...gov.securityCouncil.members, ...gov.guardians.members, board.zkFoundation],
      EMERGENCY_ACTIONS,
      board.domain
    ),
    executedEmergencies(),
  ]);

  const byId = new Map<string, EmergencySummary>();
  const entry = (id: Hex) => {
    const key = id.toLowerCase();
    let e = byId.get(key);
    if (!e) {
      e = {
        id,
        executed: null,
        reported: { securityCouncil: 0, guardians: 0, zkFoundation: false },
        firstSeen: null,
      };
      byId.set(key, e);
    }
    return e;
  };
  for (const group of collected.groups) {
    const e = entry(group.typedData.message.id as Hex);
    const n = group.reportedSigners.length;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeSecurityCouncil")
      e.reported.securityCouncil = n;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeGuardians")
      e.reported.guardians = n;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeZKFoundation")
      e.reported.zkFoundation = n > 0;
    if (!e.firstSeen || group.firstSeen < e.firstSeen) e.firstSeen = group.firstSeen;
  }
  for (const ex of executed) {
    entry(ex.id).executed = { txHash: ex.txHash, blockNumber: ex.blockNumber.toString() };
  }

  const all = [...byId.values()];
  const recent = (e: EmergencySummary) => e.firstSeen ?? "";
  return {
    pending: all.filter((e) => !e.executed).sort((a, b) => (recent(a) < recent(b) ? 1 : -1)),
    executed: all
      .filter((e) => e.executed)
      .sort((a, b) =>
        Number(BigInt(b.executed?.blockNumber ?? 0) - BigInt(a.executed?.blockNumber ?? 0))
      ),
    errors: collected.errors,
    anomalies: collected.anomalies,
  };
}

export type EmergencyRole = {
  key: "securityCouncil" | "guardians" | "zkFoundation";
  title: string;
  set: SignatureSet;
  used: UsedSignature[] | null;
};

export type EmergencyExecution = {
  txHash: Hex;
  blockNumber: string;
  // Rebuilt from the execution calldata.
  proposal: UpgradeProposal;
  calls: DecodedCall[];
  idMatches: boolean;
  // EmergencyUpgradeBoard's three checks re-run at the block before execution (archive state).
  historical: {
    block: string;
    checks: { role: string; accepted: boolean | null; error: string | null }[];
  } | null;
  historicalUnavailable: string | null;
};

export type EmergencyDetail = {
  id: Hex;
  state: number;
  roles: EmergencyRole[];
  executed: EmergencyExecution | null;
  governance: Governance;
};

export async function getEmergencyUpgrade(
  id: Hex,
  { supplied = [] }: { supplied?: MemberSignature[] } = {}
): Promise<EmergencyDetail> {
  const gov = await governance();
  const board = gov.emergencyUpgradeBoard;
  const state = await l1.readContract({
    address: gov.upgradeHandler,
    abi: upgradeHandlerAbi,
    functionName: "upgradeState",
    args: [id],
  });

  const specs = [
    {
      key: "securityCouncil",
      title: "Security Council",
      action: "ExecuteEmergencyUpgradeSecurityCouncil",
      members: gov.securityCouncil.members,
      threshold: gov.securityCouncil.eip1271Threshold,
      check: { kind: "multisig-1271", contract: gov.securityCouncil.address },
    },
    {
      key: "guardians",
      title: "Guardians",
      action: "ExecuteEmergencyUpgradeGuardians",
      members: gov.guardians.members,
      threshold: gov.guardians.eip1271Threshold,
      check: { kind: "multisig-1271", contract: gov.guardians.address },
    },
    {
      key: "zkFoundation",
      title: "ZKsync Foundation",
      action: "ExecuteEmergencyUpgradeZKFoundation",
      members: [board.zkFoundation],
      threshold: 1,
      check: { kind: "safe-1271", contract: board.zkFoundation },
    },
  ] as const;

  const sets = await Promise.all(
    specs.map((spec) =>
      verifySignatureSet({
        action: spec.action,
        signerGroup: spec.key,
        typedData: buildTypedData(spec.action, board.domain, { id }),
        members: [...spec.members],
        threshold: spec.threshold,
        check: spec.check,
        supplied,
      })
    )
  );

  let executed: EmergencyExecution | null = null;
  const roles: EmergencyRole[] = specs.map((spec, i) => ({
    key: spec.key,
    title: spec.title,
    set: sets[i] as SignatureSet,
    used: null,
  }));

  if (state === UPGRADE_STATES.Done) {
    const event = (await executedEmergencies()).find(
      (e) => e.id.toLowerCase() === id.toLowerCase()
    );
    if (event) {
      const decoded = await decodeExecution(event.txHash, board.address);
      if (decoded) {
        const { proposal, guardians, securityCouncil, zkFoundation } = decoded;
        roles[0] = {
          ...(roles[0] as EmergencyRole),
          used: compareUsedSignatures(securityCouncil, (roles[0] as EmergencyRole).set),
        };
        roles[1] = {
          ...(roles[1] as EmergencyRole),
          used: compareUsedSignatures(guardians, (roles[1] as EmergencyRole).set),
        };
        roles[2] = {
          ...(roles[2] as EmergencyRole),
          used: compareUsedSignatures(
            { signers: [board.zkFoundation], signatures: [zkFoundation] },
            (roles[2] as EmergencyRole).set
          ),
        };
        const block = event.blockNumber - 1n;
        const archive = await hasArchiveState(board.address, block);
        executed = {
          txHash: event.txHash,
          blockNumber: event.blockNumber.toString(),
          proposal,
          calls: proposal.calls.map(decodeCall),
          idMatches: upgradeProposalId(proposal).toLowerCase() === id.toLowerCase(),
          historical: archive
            ? {
                block: block.toString(),
                checks: await cached(
                  `emergency-recheck:${event.txHash}`,
                  gov.network.isDevNode ? 0 : 10 * 60_000,
                  () =>
                    Promise.all([
                      check1271(
                        gov.securityCouncil.address,
                        sets[0] as SignatureSet,
                        securityCouncil,
                        block,
                        "Security Council"
                      ),
                      check1271(
                        gov.guardians.address,
                        sets[1] as SignatureSet,
                        guardians,
                        block,
                        "Guardians"
                      ),
                      checkSafe(board.zkFoundation, sets[2] as SignatureSet, zkFoundation, block),
                    ])
                ),
              }
            : null,
          historicalUnavailable: archive
            ? null
            : "RPC has no archive state for the execution block",
        };
      }
    }
  }

  return { id, state, roles, executed, governance: gov };
}

type Blob = { signers: readonly Address[]; signatures: readonly Hex[] };

/** calls, salt and the three signature blobs from an executeEmergencyUpgrade transaction. */
async function decodeExecution(txHash: Hex, board: Address) {
  return cached(`emergency-exec:${txHash}`, Number.POSITIVE_INFINITY, async () => {
    const call = await callTo(txHash, board);
    if (!call) return null;
    const { functionName, args } = decodeFunctionData({
      abi: emergencyUpgradeBoardAbi,
      data: call.data,
    });
    if (functionName !== "executeEmergencyUpgrade") return null;
    const [calls, salt, guardiansBlob, councilBlob, zkFoundation] = args;
    const unpack = (blob: Hex): Blob => {
      const [signers, signatures] = decodeAbiParameters(
        [{ type: "address[]" }, { type: "bytes[]" }],
        blob
      );
      return { signers: signers.map((s) => getAddress(s)), signatures };
    };
    const proposal: UpgradeProposal = {
      calls: calls.map((c) => ({
        target: getAddress(c.target),
        value: c.value.toString(),
        data: c.data,
      })),
      executor: board,
      salt,
    };
    return {
      proposal,
      guardians: unpack(guardiansBlob),
      securityCouncil: unpack(councilBlob),
      zkFoundation,
    };
  });
}

async function check1271(
  contract: Address,
  set: SignatureSet,
  used: Blob,
  block: bigint,
  role: string
) {
  try {
    const result = await l1.readContract({
      address: contract,
      abi: safeAbi,
      functionName: "isValidSignature",
      args: [
        set.hashes.digest,
        encodeMultisigSignature(
          used.signers.map((signer, i) => ({ signer, signature: used.signatures[i] as Hex }))
        ),
      ],
      blockNumber: block,
    });
    return { role, accepted: result === ERC1271_MAGIC_VALUE, error: null };
  } catch (error) {
    return { role, accepted: isRevert(error) ? false : null, error: revertReason(error) };
  }
}

async function checkSafe(safe: Address, set: SignatureSet, signature: Hex, block: bigint) {
  try {
    const result = await l1.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "isValidSignature",
      args: [set.hashes.digest, signature],
      blockNumber: block,
    });
    return { role: "ZKsync Foundation", accepted: result === ERC1271_MAGIC_VALUE, error: null };
  } catch (error) {
    return {
      role: "ZKsync Foundation",
      accepted: isRevert(error) ? false : null,
      error: revertReason(error),
    };
  }
}
