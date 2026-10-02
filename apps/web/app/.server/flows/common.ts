import { guardiansAbi, securityCouncilAbi } from "@/common/abis";
import type { Execution, MemberSignature } from "@/common/execution";
import {
  type AbiEvent,
  type Address,
  type Hex,
  decodeEventLog,
  decodeFunctionData,
  isAddressEqual,
  parseAbi,
  toEventSelector,
} from "viem";
import { cached } from "../cache";
import { getLogs } from "../logs";
import { l1 } from "../rpc";
import { type SignatureSet, type Simulation, simulate } from "../signatures";

export type SetState =
  | { status: "open" }
  | { status: "done"; detail: string; txHash: Hex | null }
  | { status: "closed"; detail: string };

export type ExecutionView = Execution & { simulation: Simulation };

/** What the signature set adds up to on-chain right now: a ready transaction or why not. */
export async function executionFor(
  set: SignatureSet,
  state: SetState,
  build: (valid: MemberSignature[]) => Execution | null
): Promise<ExecutionView | null> {
  if (state.status !== "open" || set.thresholdCheck.status !== "met") return null;
  const execution = build(set.valid);
  if (!execution) return null;
  return { ...execution, simulation: await simulate(execution) };
}

export function topicOf(abi: readonly unknown[], name: string): Hex {
  const event = (abi as AbiEvent[]).find((item) => item.type === "event" && item.name === name);
  if (!event) throw new Error(`No event ${name} in ABI`);
  return toEventSelector(event);
}

/** Logs of one event with the indexed id, decoded. */
export async function eventsWithId(
  address: Address,
  abi: readonly unknown[],
  name: string,
  id: Hex,
  fromBlock: bigint,
  toBlock?: bigint
) {
  const logs = await getLogs(l1, { address, topics: [topicOf(abi, name), id] }, fromBlock, toBlock);
  return logs.map((log) => ({
    log,
    event: decodeEventLog({ abi: abi as never, data: log.data, topics: log.topics }) as unknown as {
      args: Record<string, unknown>;
    },
  }));
}

const execTransactionAbi = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);

type SignedCall = { to: Address; data: Hex };

/**
 * The call a transaction made to `target`, also when wrapped in a Safe execTransaction (the
 * Security Council approval in 0x1defa4f7… was sent that way). Returns null for anything else.
 */
export async function callTo(txHash: Hex, target: Address): Promise<SignedCall | null> {
  return cached(`call-to:${txHash}:${target}`, Number.POSITIVE_INFINITY, async () => {
    const tx = await l1.getTransaction({ hash: txHash });
    if (tx.to && isAddressEqual(tx.to, target)) return { to: tx.to, data: tx.input };
    try {
      const { args } = decodeFunctionData({ abi: execTransactionAbi, data: tx.input });
      if (isAddressEqual(args[0], target)) return { to: args[0], data: args[2] };
    } catch {}
    return null;
  });
}

export type UsedSignature = MemberSignature & { matchesSafe: boolean | null };

/** Signers/signatures an executed approval passed to the contract, compared with Safe's copies. */
export function compareUsedSignatures(
  used: { signers: readonly Address[]; signatures: readonly Hex[] },
  set: SignatureSet
): UsedSignature[] {
  return used.signers.map((signer, i) => {
    const member = set.members.find((m) => isAddressEqual(m.member, signer));
    const signature = used.signatures[i] as Hex;
    const fromSafe = member?.source === "safe" ? member.signature : null;
    return {
      signer,
      signature,
      matchesSafe: fromSafe === null ? null : fromSafe.toLowerCase() === signature.toLowerCase(),
    };
  });
}

/** Decodes approve*(id, signers, signatures) / extendLegalVeto from SecurityCouncil or Guardians. */
export function decodeApprovalCall(data: Hex) {
  for (const abi of [securityCouncilAbi, guardiansAbi]) {
    try {
      const { functionName, args } = decodeFunctionData({ abi, data });
      if (
        functionName === "approveUpgradeSecurityCouncil" ||
        functionName === "approveUpgradeGuardians" ||
        functionName === "extendLegalVeto"
      ) {
        const [id, signers, signatures] = args as [Hex, readonly Address[], readonly Hex[]];
        return { functionName, id, signers, signatures };
      }
    } catch {}
  }
  return null;
}

/** True when the RPC can answer eth_call at a past block (needed to re-check executed signatures). */
export function hasArchiveState(address: Address, blockNumber: bigint): Promise<boolean> {
  return cached(`archive:${blockNumber}`, 10 * 60_000, () =>
    l1
      .getBalance({ address, blockNumber })
      .then(() => true)
      .catch(() => false)
  );
}
