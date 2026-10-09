import {
  ERC1271_MAGIC_VALUE,
  emergencyUpgradeBoardAbi,
  safeAbi,
  upgradeHandlerAbi,
} from "@/common/abis";
import { type MemberSignature, encodeMultisigSignature } from "@/common/execution";
import { EMERGENCY_RECENT_DAYS } from "@/common/emergency";
import {
  type DecodedCall,
  type UpgradeProposal,
  decodeCall,
  upgradeProposalId,
} from "@/common/proposal";
import { type ActionName, buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Address, type Hex, decodeAbiParameters, decodeFunctionData, getAddress } from "viem";
import { cached } from "../cache";
import { type PuhEvent, puhIndex } from "../chain/puh-index";
import { type Governance, governance } from "../governance";
import { findBlockByTimestamp, getLogs } from "../logs";
import { type Network, blockTimestamps, l1, latestBlock, network } from "../rpc";
import { type SignatureSet, isRevert, revertReason, verifySignatureSet } from "../signatures";
import {
  type UsedSignature,
  callTo,
  compareUsedSignatures,
  hasArchiveState,
  topicOf,
} from "./common";
import { collectMessages } from "./messages";
import { findEmergencyEvent } from "./emergency-event";

// Emergency upgrades sign only the id = keccak256(abi.encode(calls, executor, salt)); Safe never
// sees the calls or salt. Before execution they must come from the proposer (a payload file the
// browser checks against the id, client-side). After execution they are rebuilt from the calldata.

const EMERGENCY_ACTIONS = [
  "ExecuteEmergencyUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeGuardians",
  "ExecuteEmergencyUpgradeZKFoundation",
] as const satisfies readonly ActionName[];

type Executed = { id: Hex; txHash: Hex; blockNumber: bigint };

// Headers read per round when cutting the recent window by timestamp (one JSON-RPC batch).
const TIMESTAMP_BATCH = 20;

/**
 * Executed emergency upgrades, oldest first, from the handler's log index (complete from the
 * deployment to the head, or an error). Full history is opt-in for pages; the JSON list retains
 * it by default.
 */
async function executedEmergencies({ allHistory = true } = {}): Promise<Executed[]> {
  const net = await network();
  if (net.isDevNode) return legacyExecutedEmergencies(net, allHistory);
  const toExecuted = ({ args, log }: PuhEvent<"EmergencyUpgradeExecuted">): Executed => ({
    id: args._id,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
  });
  if (allHistory) return (await puhIndex().events("EmergencyUpgradeExecuted")).map(toExecuted);
  // The recent window: executed in a block with timestamp >= head − 7 days. A slot holds at most
  // one block, so those blocks are within the last 7 days / block time; twice that is asked of
  // the index, so the window needs only recent coverage (not the whole backfill). The cut itself
  // is by timestamp: the newest executions are read first, a batch at a time, until one is older.
  const head = await latestBlock();
  const recentSeconds = BigInt(EMERGENCY_RECENT_DAYS * 24 * 60 * 60);
  const cutoff = head.timestamp - recentSeconds;
  const below = head.number - (2n * recentSeconds) / BigInt(net.blockTimeSeconds);
  const fromBlock = below > net.upgradeHandlerDeployBlock ? below : net.upgradeHandlerDeployBlock;
  const executed = (await puhIndex().events("EmergencyUpgradeExecuted", { fromBlock })).map(
    toExecuted
  );
  let end = executed.length;
  while (end > 0) {
    const start = Math.max(0, end - TIMESTAMP_BATCH);
    const times = await blockTimestamps(executed.slice(start, end).map((e) => e.blockNumber));
    for (let i = end - 1; i >= start; i--) {
      const time = times.get((executed[i] as Executed).blockNumber) as bigint;
      if (time < cutoff) return executed.slice(i + 1);
    }
    end = start;
  }
  return executed;
}

/** Dev nodes (which can be rewound) keep the direct scan from the recent window's first block. */
async function legacyExecutedEmergencies(net: Network, allHistory: boolean): Promise<Executed[]> {
  const head = await latestBlock();
  const recentFrom = allHistory
    ? net.upgradeHandlerDeployBlock
    : await findBlockByTimestamp(
        l1,
        head.timestamp - BigInt(EMERGENCY_RECENT_DAYS * 24 * 60 * 60),
        net.upgradeHandlerDeployBlock,
        head.number,
        null
      );
  const logs = await getLogs(
    l1,
    {
      address: net.upgradeHandler,
      topics: [topicOf(upgradeHandlerAbi, "EmergencyUpgradeExecuted")],
    },
    recentFrom,
    head.number
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

const summary = (id: Hex): EmergencySummary => ({
  id,
  executed: null,
  reported: { securityCouncil: 0, guardians: 0, zkFoundation: false },
  firstSeen: null,
});

/** Pending Safe messages and executed events do not wait for one another. */
export async function loadEmergencyList({ allHistory = false } = {}) {
  const gov = await governance();
  const board = gov.emergencyUpgradeBoard;
  const pending = collectMessages(
    [...gov.securityCouncil.members, ...gov.guardians.members, board.zkFoundation],
    EMERGENCY_ACTIONS,
    board.domain
  ).then(async (collected) => {
    const byId = new Map<string, EmergencySummary>();
    for (const group of collected.groups) {
      const id = group.typedData.message.id as Hex;
      const key = id.toLowerCase();
      const entry = byId.get(key) ?? summary(id);
      byId.set(key, entry);
      const n = group.reportedSigners.length;
      if (group.typedData.primaryType === "ExecuteEmergencyUpgradeSecurityCouncil")
        entry.reported.securityCouncil = n;
      if (group.typedData.primaryType === "ExecuteEmergencyUpgradeGuardians")
        entry.reported.guardians = n;
      if (group.typedData.primaryType === "ExecuteEmergencyUpgradeZKFoundation")
        entry.reported.zkFoundation = n > 0;
      if (!entry.firstSeen || group.firstSeen < entry.firstSeen) entry.firstSeen = group.firstSeen;
    }
    // Concurrent current-state calls are batched by the RPC client. No archive or log scan needed.
    const entries = await Promise.all(
      [...byId.values()].map(async (entry) => {
        const status = await l1.readContract({
          address: gov.upgradeHandler,
          abi: upgradeHandlerAbi,
          functionName: "upgradeStatus",
          args: [entry.id],
        });
        return status[4] ? null : entry;
      })
    );
    return {
      pending: entries
        .filter((entry): entry is EmergencySummary => entry !== null)
        .sort((a, b) => ((a.firstSeen ?? "") < (b.firstSeen ?? "") ? 1 : -1)),
      errors: collected.errors,
      anomalies: collected.anomalies,
    };
  });
  const executed = executedEmergencies({ allHistory }).then((events) =>
    events
      .map((event) => ({
        ...summary(event.id),
        executed: { txHash: event.txHash, blockNumber: event.blockNumber.toString() },
      }))
      .reverse()
  );
  for (const promise of [pending, executed]) void promise.catch(() => {});
  return { pending, executed };
}

export async function listRecentEmergencyUpgrades() {
  const loading = await loadEmergencyList();
  const [pending, executed] = await Promise.all([loading.pending, loading.executed]);
  return { ...pending, executed };
}

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

export type EmergencyOverview = Pick<EmergencyDetail, "id" | "state" | "governance">;

/** Start execution discovery and current Safe verification independently. */
export async function loadEmergencyUpgrade(
  id: Hex,
  { supplied = [] }: { supplied?: MemberSignature[] } = {}
) {
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

  const sets = Promise.all(
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

  const executed = (async (): Promise<EmergencyExecution | null> => {
    if (state !== UPGRADE_STATES.Done) return null;
    const event = await findEmergencyEvent(id);
    if (event) {
      const decoded = await decodeExecution(event.txHash, board.address);
      if (decoded) {
        const { proposal, guardians, securityCouncil, zkFoundation } = decoded;
        const block = event.blockNumber - 1n;
        const archive = await hasArchiveState(board.address, block);
        const hashes = specs.map((spec) => ({
          hashes: governanceHashes(buildTypedData(spec.action, board.domain, { id })),
        }));
        return {
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
                        hashes[0] as Pick<SignatureSet, "hashes">,
                        securityCouncil,
                        block,
                        "Security Council"
                      ),
                      check1271(
                        gov.guardians.address,
                        hashes[1] as Pick<SignatureSet, "hashes">,
                        guardians,
                        block,
                        "Guardians"
                      ),
                      checkSafe(
                        board.zkFoundation,
                        hashes[2] as Pick<SignatureSet, "hashes">,
                        zkFoundation,
                        block
                      ),
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
    return null;
  })();

  const overview: EmergencyOverview = { id, state, governance: gov };
  const detail = Promise.all([sets, executed]).then(async ([sets, execution]) => {
    const decoded = execution ? await decodeExecution(execution.txHash, board.address) : null;
    const used = decoded
      ? [
          decoded.securityCouncil,
          decoded.guardians,
          {
            signers: [board.zkFoundation],
            signatures: [decoded.zkFoundation],
          },
        ]
      : [];
    const roles: EmergencyRole[] = specs.map((spec, i) => ({
      key: spec.key,
      title: spec.title,
      set: sets[i] as SignatureSet,
      used: used[i] ? compareUsedSignatures(used[i] as Blob, sets[i] as SignatureSet) : null,
    }));
    return { ...overview, roles, executed: execution } satisfies EmergencyDetail;
  });
  // Deferred loaders attach their own error handlers after this function returns.
  for (const pending of [sets, executed, detail]) void pending.catch(() => {});
  return { overview, executed, detail };
}

/** JSON retains the complete verification result, including comparisons with Safe's copies. */
export async function getEmergencyUpgrade(
  id: Hex,
  options: { supplied?: MemberSignature[] } = {}
): Promise<EmergencyDetail> {
  return (await loadEmergencyUpgrade(id, options)).detail;
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
  set: Pick<SignatureSet, "hashes">,
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

async function checkSafe(
  safe: Address,
  set: Pick<SignatureSet, "hashes">,
  signature: Hex,
  block: bigint
) {
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
