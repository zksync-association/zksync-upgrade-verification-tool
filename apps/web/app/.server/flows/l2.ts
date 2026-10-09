import { guardiansAbi, l1MessengerEventAbi, l2GovernorAbi, upgradeHandlerAbi } from "@/common/abis";
import type { L2Proposal } from "@/common/execution";
import {
  type Address,
  type Hex,
  type PublicClient,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  isAddressEqual,
  keccak256,
  numberToHex,
  toHex,
} from "viem";
import { getLogProof } from "viem/zksync";
import { cached } from "../cache";
import { governance } from "../governance";
import { findBlockByTimestamp, getLogs } from "../logs";
import { l1, l2, network } from "../rpc";
import { callTo, topicOf } from "./common";
import { L1_MESSENGER, findL2ProposalInBatch, upgradeBatch } from "./l2-batch";

// ZKsync Era side of governance: the governors Guardians can veto, and the protocol governor whose
// executed proposals start L1 upgrades. Era's public RPC serves wide log ranges, so windows are
// scanned directly; results near the head are never cached.

const DAY = 86_400n;

// IGovernor.ProposalState
export const L2_PROPOSAL_STATES = [
  "Pending",
  "Active",
  "Canceled",
  "Defeated",
  "Succeeded",
  "Queued",
  "Expired",
  "Executed",
] as const;
export type L2ProposalStateName = (typeof L2_PROPOSAL_STATES)[number];

export type L2GovernorKind = "token" | "govOps" | "protocol";

export async function knownGovernors(): Promise<
  { kind: L2GovernorKind; name: string; address: Address }[]
> {
  const { l2Governors } = await network();
  return [
    { kind: "token" as const, name: "ZkTokenGovernor", address: l2Governors.token },
    { kind: "govOps" as const, name: "ZkGovOpsGovernor", address: l2Governors.govOps },
    { kind: "protocol" as const, name: "ZkProtocolGovernor", address: l2Governors.protocol },
  ].filter(
    (g): g is { kind: L2GovernorKind; name: string; address: Address } => g.address !== null
  );
}

async function l2Head(client: PublicClient) {
  return cached("l2-head", 4_000, () => client.getBlock({ blockTag: "latest" }));
}

async function l2BlockAt(client: PublicClient, timestamp: bigint) {
  const head = await l2Head(client);
  if (timestamp >= head.timestamp) return head.number;
  return findBlockByTimestamp(client, timestamp, 1n, head.number, {
    key: "l2",
    safeHead: head.number - 1_000n,
  });
}

export type L2ProposalView = L2Proposal & {
  governor: Address;
  governorName: string | null;
  proposalId: string;
  proposer: Address;
  state: L2ProposalStateName | null;
  voteStart: string;
  voteEnd: string;
  // hashL2Proposal recomputed locally and by Guardians.hashL2Proposal on L1; both must equal the id.
  idMatchesLocal: boolean;
  idMatchesContract: boolean | null;
  createdTx: Hex;
};

function hashL2Proposal(p: L2Proposal): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
        [p.targets, p.values.map(BigInt), p.calldatas, keccak256(toHex(p.description))]
      )
    )
  );
}

async function decodeCreated(
  client: PublicClient,
  governor: Address,
  log: Awaited<ReturnType<typeof getLogs>>[number]
): Promise<L2ProposalView> {
  const { args } = decodeEventLog({
    abi: l2GovernorAbi,
    eventName: "ProposalCreated",
    data: log.data,
    topics: log.topics,
  });
  const proposal: L2Proposal = {
    targets: args.targets.map((t) => getAddress(t)),
    values: args.values.map((v) => v.toString()),
    calldatas: [...args.calldatas],
    description: args.description,
  };
  const [state, governorName, contractId] = await Promise.all([
    client
      .readContract({
        address: governor,
        abi: l2GovernorAbi,
        functionName: "state",
        args: [args.proposalId],
      })
      // null only for a value outside IGovernor.ProposalState. A failed read fails the caller,
      // whatever its kind: a proposal whose state went unread must neither drop out of what
      // Guardians can veto nor close its veto. (viem turns Era's code-3 revert and an internal
      // error -32603 into the same ContractFunctionRevertedError, so no failure here is an answer.)
      .then((s) => L2_PROPOSAL_STATES[s] ?? null),
    knownGovernors().then(
      (gs) => gs.find((g) => isAddressEqual(g.address, governor))?.name ?? null
    ),
    governance()
      .then((gov) =>
        l1.readContract({
          address: gov.guardians.address,
          abi: guardiansAbi,
          functionName: "hashL2Proposal",
          args: [
            {
              targets: proposal.targets,
              values: proposal.values.map(BigInt),
              calldatas: proposal.calldatas,
              description: proposal.description,
            },
          ],
        })
      )
      .catch(() => null),
  ]);
  return {
    ...proposal,
    governor,
    governorName,
    proposalId: args.proposalId.toString(),
    proposer: getAddress(args.proposer),
    state,
    voteStart: args.voteStart.toString(),
    voteEnd: args.voteEnd.toString(),
    idMatchesLocal: hashL2Proposal(proposal) === args.proposalId,
    idMatchesContract: contractId === null ? null : contractId === args.proposalId,
    createdTx: log.transactionHash as Hex,
  };
}

/**
 * Proposals on the Token and GovOps governors that Guardians can still veto (Pending or Active,
 * or a state value the app does not know: listed rather than hidden). A failed read fails the list.
 */
export async function activeL2Proposals(): Promise<L2ProposalView[]> {
  const client = await l2();
  if (!client) return [];
  const head = await l2Head(client);
  // 3-day voting delay + 7-day voting period + 7-day possible extension, with margin.
  const from = await l2BlockAt(client, head.timestamp - 24n * DAY);
  const governors = (await knownGovernors()).filter((g) => g.kind !== "protocol");
  const lists = await Promise.all(
    governors.map(async (g) => {
      const logs = await getLogs(
        client,
        { address: g.address, topics: [topicOf(l2GovernorAbi, "ProposalCreated")] },
        from,
        head.number,
        { safeHead: -1n }
      );
      return Promise.all(logs.map((log) => decodeCreated(client, g.address, log)));
    })
  );
  return lists
    .flat()
    .filter((p) => p.state === null || p.state === "Pending" || p.state === "Active");
}

/** A specific L2 proposal's content, found from its on-chain snapshot time. */
export async function getL2Proposal(
  governor: Address,
  proposalId: bigint
): Promise<L2ProposalView | null> {
  const client = await l2();
  if (!client) return null;
  return cached(`l2-proposal:${governor}:${proposalId}`, 5 * 60_000, async () => {
    const [snapshot, votingDelay] = await Promise.all([
      client.readContract({
        address: governor,
        abi: l2GovernorAbi,
        functionName: "proposalSnapshot",
        args: [proposalId],
      }),
      client.readContract({ address: governor, abi: l2GovernorAbi, functionName: "votingDelay" }),
    ]);
    if (snapshot === 0n) return null;
    // Created at snapshot - votingDelay, unless the delay changed since; widen the window for that.
    const from = await l2BlockAt(client, snapshot - votingDelay - 7n * DAY);
    const to = await l2BlockAt(client, snapshot);
    const logs = await getLogs(
      client,
      { address: governor, topics: [topicOf(l2GovernorAbi, "ProposalCreated")] },
      from,
      to,
      { safeHead: -1n }
    );
    // Only the matching proposal is read further: another proposal's failed state() read must
    // not fail this one.
    const log = logs.find(
      (l) =>
        decodeEventLog({
          abi: l2GovernorAbi,
          eventName: "ProposalCreated",
          data: l.data,
          topics: l.topics,
        }).args.proposalId === proposalId
    );
    return log ? decodeCreated(client, governor, log) : null;
  });
}

/** ZkProtocolGovernor proposal whose L2 → L1 message is the upgrade `l1Id` (for the Tally link). */
export async function findL2ProposalForUpgrade(
  l1Id: Hex,
  creationTimestamp: number,
  { startedTxHash, strategy = "batch" }: { startedTxHash?: Hex; strategy?: "batch" | "legacy" } = {}
) {
  const client = await l2();
  const { l2Governors, isDevNode, upgradeHandler } = await network();
  if (!client || !l2Governors.protocol) return null;
  const governor = l2Governors.protocol;
  return cached(
    `l2-for-upgrade:${strategy}:${l1Id}`,
    isDevNode ? 0 : Number.POSITIVE_INFINITY,
    async () => {
      if (strategy === "batch" && startedTxHash) {
        try {
          const call = await callTo(startedTxHash, upgradeHandler);
          const batch = call ? upgradeBatch(call.data, l1Id) : null;
          if (batch !== null) {
            const match = await findL2ProposalInBatch(client, l1Id, governor, batch);
            if (match) return match;
          }
        } catch {
          // Unsupported RPC methods or unavailable batch history retain the existing discovery path.
        }
      }
      const from = await l2BlockAt(client, BigInt(creationTimestamp) - 21n * DAY);
      const to = await l2BlockAt(client, BigInt(creationTimestamp));
      const logs = await getLogs(
        client,
        { address: governor, topics: [topicOf(l2GovernorAbi, "ProposalExecuted")] },
        from,
        to,
        { safeHead: -1n }
      );
      for (const log of logs) {
        const message = await l1MessageOf(client, log.transactionHash as Hex);
        if (message && keccak256(message.body) === l1Id) {
          const { args } = decodeEventLog({
            abi: l2GovernorAbi,
            eventName: "ProposalExecuted",
            data: log.data,
            topics: log.topics,
          });
          return {
            governor,
            proposalId: args.proposalId.toString(),
            executedTx: log.transactionHash as Hex,
          };
        }
      }
      return null;
    }
  );
}

async function l1MessageOf(client: PublicClient, txHash: Hex) {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const log = receipt.logs.find(
    (l) =>
      isAddressEqual(l.address, L1_MESSENGER) &&
      l.topics[0] === topicOf(l1MessengerEventAbi, "L1MessageSent")
  );
  if (!log) return null;
  const { args } = decodeEventLog({ abi: l1MessengerEventAbi, data: log.data, topics: log.topics });
  return { body: args._message, receipt };
}

export type NotStartedUpgrade = {
  l2ProposalId: Hex;
  executedTx: Hex;
} & (
  | {
      ok: true;
      l1ProposalId: Hex;
      data: {
        l2BatchNumber: Hex;
        l2MessageIndex: Hex;
        l2TxNumberInBatch: Hex | null;
        proof: Hex[];
        proposal: Hex;
      };
    }
  | { ok: false; error: string }
);

/** Executed ZkProtocolGovernor proposals whose L1 upgrade has not been started yet. */
export async function notStartedUpgrades(): Promise<NotStartedUpgrade[]> {
  const client = await l2();
  const net = await network();
  if (!client || !net.l2Governors.protocol) return [];
  const head = await l2Head(client);
  const from = await l2BlockAt(client, head.timestamp - 30n * DAY);
  const logs = await getLogs(
    client,
    { address: net.l2Governors.protocol, topics: [topicOf(l2GovernorAbi, "ProposalExecuted")] },
    from,
    head.number,
    { safeHead: -1n }
  );
  const results = await Promise.all(
    logs.map(async (log): Promise<NotStartedUpgrade | null> => {
      const { args } = decodeEventLog({
        abi: l2GovernorAbi,
        eventName: "ProposalExecuted",
        data: log.data,
        topics: log.topics,
      });
      const l2ProposalId = numberToHex(args.proposalId);
      const executedTx = log.transactionHash as Hex;
      const message = await l1MessageOf(client, executedTx);
      if (!message)
        return {
          l2ProposalId,
          executedTx,
          ok: false,
          error: "No L2 → L1 message in the execution",
        };
      const l1ProposalId = keccak256(message.body);
      const state = await l1.readContract({
        address: net.upgradeHandler,
        abi: upgradeHandlerAbi,
        functionName: "upgradeState",
        args: [l1ProposalId],
      });
      if (state !== 0) return null;
      // Era receipts carry batch fields (zksync formatters on the L2 client).
      const receipt = message.receipt as typeof message.receipt & {
        l1BatchNumber: bigint | null;
        l1BatchTxIndex: bigint | null;
      };
      if (receipt.l1BatchNumber === null) {
        return { l2ProposalId, executedTx, ok: false, error: "Not included in an L1 batch yet" };
      }
      const proof = await getLogProof(client as never, { txHash: executedTx, index: 0 }).catch(
        () => null
      );
      if (!proof)
        return {
          l2ProposalId,
          executedTx,
          ok: false,
          error: "L2 → L1 log proof not available yet",
        };
      return {
        l2ProposalId,
        executedTx,
        ok: true,
        l1ProposalId,
        data: {
          l2BatchNumber: numberToHex(receipt.l1BatchNumber),
          l2MessageIndex: numberToHex(proof.id),
          l2TxNumberInBatch:
            receipt.l1BatchTxIndex !== null ? numberToHex(receipt.l1BatchTxIndex) : null,
          proof: proof.proof,
          proposal: message.body,
        },
      };
    })
  );
  return results.filter((r): r is NotStartedUpgrade => r !== null);
}
