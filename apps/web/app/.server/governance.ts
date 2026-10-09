import {
  emergencyUpgradeBoardAbi,
  guardiansAbi,
  safeAbi,
  securityCouncilAbi,
  upgradeHandlerAbi,
} from "@/common/abis";
import { safeMessageHashes } from "@/common/safe";
import type { Eip712Domain } from "@/common/typed-data";
import {
  type Abi,
  type Address,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  isHex,
  multicall3Abi,
  numberToHex,
  zeroHash,
} from "viem";
import { cached, linkStore } from "./cache";
import { callFn, classify, isUnknownBlock } from "./chain/call";
import { readMemberList } from "./member-list";
import { type BlockRef, MULTICALL3, type Network, l1, lanes, latestBlock, network } from "./rpc";

// Everything the old database cached about roles and thresholds is re-read from the chain. The
// only pinned input is the ProtocolUpgradeHandler address; the rest is derived from it.

export type Multisig = {
  address: Address;
  domain: Eip712Domain;
  members: Address[];
  eip1271Threshold: number;
};

export type Governance = {
  network: Pick<
    Network,
    | "name"
    | "label"
    | "chainId"
    | "explorerUrl"
    | "l2ExplorerUrl"
    | "tallyUrl"
    | "isDevNode"
    | "overrides"
    | "standardLegalVetoDays"
    | "safeWalletPrefix"
  >;
  upgradeHandler: Address;
  securityCouncil: Multisig & {
    thresholds: {
      approveUpgrade: number;
      softFreeze: number;
      softFreezeConservative: number;
      hardFreeze: number;
      unfreeze: number;
    };
    nonces: {
      softFreeze: string;
      hardFreeze: string;
      unfreeze: string;
      setSoftFreezeThreshold: string;
    };
  };
  guardians: Multisig & {
    thresholds: { approveUpgrade: number; extendLegalVeto: number; cancelL2Proposal: number };
    nonce: string;
  };
  emergencyUpgradeBoard: { address: Address; domain: Eip712Domain; zkFoundation: Address };
  freeze: { protocolFrozenUntil: string; lastFreezeStatus: number };
  latestBlock: { number: string; timestamp: string };
  // Inconsistencies between contracts. Any of these means something is wrong; the UI shows them.
  warnings: string[];
};

const read = <T>(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint
) => l1.readContract({ address, abi, functionName, args, blockNumber }) as Promise<T>;

/**
 * A read whose failure decides something: a contract without eip712Domain(), a Safe without a
 * getter (member lists confirm the same way, in readMembers). It goes out with the other reads
 * (through Multicall3); a failed one is asked again directly (chain/call.ts), whose error then
 * says whether the contract reverted. A failed Multicall3 sub-call carries no error code, and one
 * that ran out of gas looks like a revert.
 */
async function confirmedRead<T>(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint
): Promise<T> {
  try {
    return await read<T>(address, abi, functionName, args, blockNumber);
  } catch {
    return callFn<T>({ address, abi, functionName, args, blockNumber });
  }
}

/** The direct read's answer to "is this getter missing?": null on a definite revert. */
const orNullOnRevert = (error: unknown) => {
  if (classify(error) === "revert") return null;
  throw error;
};

async function readMembers(
  address: Address,
  abi: Abi,
  blockNumber: bigint | undefined
): Promise<Address[]> {
  // Batched reads; only the first index that fails is asked again directly. Past the end of the
  // list every read fails, and one direct answer (a definite revert) is enough.
  return readMemberList(
    (index) => read<Address>(address, abi, "members", [index], blockNumber),
    (index) =>
      callFn<Address>({ address, abi, functionName: "members", args: [index], blockNumber })
  );
}

/** eip712Domain()'s answer, or null when the contract definitely has none (it reverts). */
type DomainAnswer = readonly [string, string, string, bigint, Address, ...unknown[]] | null;

/** What a governance read gathers, before it is checked and shaped (see shape). */
type Reads = {
  puh: Address;
  sc: Address;
  g: Address;
  eub: Address;
  frozenUntil: bigint;
  freezeStatus: number;
  scMembers: Address[];
  gMembers: Address[];
  scDomain: DomainAnswer;
  gDomain: DomainAnswer;
  eubDomain: DomainAnswer;
  /** SC_GETTERS' answers, in that order. */
  scValues: readonly unknown[];
  /** G_GETTERS' answers, in that order. */
  gValues: readonly unknown[];
  /** EUB_GETTERS' answers, in that order. */
  eubValues: readonly unknown[];
};

const PUH_GETTERS = [
  "securityCouncil",
  "guardians",
  "emergencyUpgradeBoard",
  "protocolFrozenUntil",
  "lastFreezeStatusInUpgradeCycle",
] as const;
const SC_GETTERS = [
  "EIP1271_THRESHOLD",
  "APPROVE_UPGRADE_SECURITY_COUNCIL_THRESHOLD",
  "softFreezeThreshold",
  "SOFT_FREEZE_CONSERVATIVE_THRESHOLD",
  "HARD_FREEZE_THRESHOLD",
  "UNFREEZE_THRESHOLD",
  "softFreezeNonce",
  "hardFreezeNonce",
  "unfreezeNonce",
  "softFreezeThresholdSettingNonce",
  "PROTOCOL_UPGRADE_HANDLER",
] as const;
const G_GETTERS = [
  "EIP1271_THRESHOLD",
  "APPROVE_UPGRADE_GUARDIANS_THRESHOLD",
  "EXTEND_LEGAL_VETO_THRESHOLD",
  "CANCEL_L2_GOVERNOR_PROPOSAL_THRESHOLD",
  "nonce",
  "PROTOCOL_UPGRADE_HANDLER",
] as const;
const EUB_GETTERS = [
  "ZK_FOUNDATION_SAFE",
  "SECURITY_COUNCIL",
  "GUARDIANS",
  "PROTOCOL_UPGRADE_HANDLER",
] as const;

const noContract = (net: Network) =>
  new Error(`No contract at ProtocolUpgradeHandler ${net.upgradeHandler} on chain ${net.chainId}`);

/**
 * Today's reads, in rounds: the handler's code and its five getters together; then every getter
 * of the three contracts the handler names, with their member lists probed 16 at a time; then the
 * first member read that failed in Multicall3, asked again directly. All at `blockNumber` (at
 * 'latest' when undefined).
 */
async function readInRounds(net: Network, blockNumber: bigint | undefined): Promise<Reads> {
  const puh = net.upgradeHandler;
  const [code, puhValues] = await Promise.all([
    l1.getCode({ address: puh, blockNumber }),
    Promise.allSettled(PUH_GETTERS.map((fn) => read(puh, upgradeHandlerAbi, fn, [], blockNumber))),
  ]);
  // Nothing else is read without contract code at the handler.
  if (!code || code === "0x") throw noContract(net);
  const values = puhValues.map((settled) => {
    if (settled.status === "rejected") throw settled.reason;
    return settled.value;
  });
  const [scAddress, gAddress, eubAddress, frozenUntil, freezeStatus] = values;
  const sc = getAddress(scAddress as Address);
  const g = getAddress(gAddress as Address);
  const eub = getAddress(eubAddress as Address);
  const domain = (address: Address, abi: Abi) =>
    confirmedRead<DomainAnswer>(address, abi, "eip712Domain", [], blockNumber).catch(
      orNullOnRevert
    );
  const all = (address: Address, abi: Abi, getters: readonly string[]) =>
    Promise.all(getters.map((fn) => read(address, abi, fn, [], blockNumber)));
  const [scMembers, gMembers, scDomain, gDomain, eubDomain, scValues, gValues, eubValues] =
    await Promise.all([
      readMembers(sc, securityCouncilAbi, blockNumber),
      readMembers(g, guardiansAbi, blockNumber),
      domain(sc, securityCouncilAbi),
      domain(g, guardiansAbi),
      domain(eub, emergencyUpgradeBoardAbi),
      all(sc, securityCouncilAbi, SC_GETTERS),
      all(g, guardiansAbi, G_GETTERS),
      all(eub, emergencyUpgradeBoardAbi, EUB_GETTERS),
    ]);
  return {
    puh,
    sc,
    g,
    eub,
    frozenUntil: frozenUntil as bigint,
    freezeStatus: freezeStatus as number,
    scMembers,
    gMembers,
    scDomain,
    gDomain,
    eubDomain,
    scValues,
    gValues,
    eubValues,
  };
}

/** What a speculative read asks for: the last read's role addresses and member counts. */
type Layout = {
  puh: Address;
  sc: Address;
  g: Address;
  eub: Address;
  scCount: number;
  gCount: number;
};

// The layout of the last read under the current settings. Dropped with governance (refresh,
// settings change, clearCache); a read that started before a drop does not set it.
let layout: Layout | null = null;
let layoutEpoch = 0;
linkStore("governance-layout", () => {
  layout = null;
  layoutEpoch++;
});

type SubCall = { target: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

/**
 * Every read of readInRounds in one POST, guessing that the handler still names the contracts it
 * named at the last read and that their member lists have the same length: the handler's code;
 * one aggregate3 of its five getters, both member lists (members(0) to members(count-1)), the
 * three domains and every other getter; and both lists' terminators members(count), directly
 * (four billed requests). Accepted only if the code is there, every sub-call succeeded with data
 * that decodes, the handler named the same three contracts, and both terminators definitely
 * reverted (a member list never ends on anything else, chain/call.ts). null otherwise: the caller
 * reads in rounds, as without the guess.
 */
async function readInOne(
  net: Network,
  blockNumber: bigint | undefined,
  guess: Layout
): Promise<Reads | null> {
  const puh = net.upgradeHandler;
  const members = (target: Address, abi: Abi, count: number): SubCall[] =>
    Array.from({ length: count }, (_, i) => ({
      target,
      abi,
      functionName: "members",
      args: [BigInt(i)],
    }));
  const getters = (target: Address, abi: Abi, names: readonly string[]): SubCall[] =>
    names.map((functionName) => ({ target, abi, functionName }));
  const calls: SubCall[] = [
    ...getters(puh, upgradeHandlerAbi, PUH_GETTERS),
    ...members(guess.sc, securityCouncilAbi, guess.scCount),
    ...members(guess.g, guardiansAbi, guess.gCount),
    { target: guess.sc, abi: securityCouncilAbi, functionName: "eip712Domain" },
    { target: guess.g, abi: guardiansAbi, functionName: "eip712Domain" },
    { target: guess.eub, abi: emergencyUpgradeBoardAbi, functionName: "eip712Domain" },
    ...getters(guess.sc, securityCouncilAbi, SC_GETTERS),
    ...getters(guess.g, guardiansAbi, G_GETTERS),
    ...getters(guess.eub, emergencyUpgradeBoardAbi, EUB_GETTERS),
  ];
  const tag = blockNumber === undefined ? "latest" : numberToHex(blockNumber);
  const lane = lanes().call;
  const aggregate = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [
      calls.map((call) => ({
        target: call.target,
        allowFailure: true,
        callData: encodeFunctionData({
          abi: call.abi,
          functionName: call.functionName,
          args: call.args ?? [],
        } as never),
      })),
    ],
  });
  const terminator = (address: Address, abi: Abi, count: number) =>
    callFn<Address>({ address, abi, functionName: "members", args: [BigInt(count)], blockNumber });
  // Sent together: the call lane puts them in one JSON-RPC batch.
  const [code, answer, scEnd, gEnd] = await Promise.allSettled([
    lane.request<unknown>("eth_getCode", [puh, tag]),
    lane.request<unknown>("eth_call", [{ to: MULTICALL3, data: aggregate }, tag]),
    terminator(guess.sc, securityCouncilAbi, guess.scCount),
    terminator(guess.g, guardiansAbi, guess.gCount),
  ]);
  for (const sent of [code, answer]) {
    if (sent.status === "fulfilled") continue;
    // A backend behind the one that named the block: asked again shortly (readGovernance), not
    // read in rounds at a block that backend does not know either.
    if (isUnknownBlock(sent.reason)) throw sent.reason;
    return null;
  }
  if (code.status !== "fulfilled" || answer.status !== "fulfilled") return null;
  if (typeof code.value !== "string" || !isHex(code.value) || /^0x0*$/.test(code.value))
    return null;
  // Both lists end exactly where they ended: a definite revert, nothing else.
  for (const end of [scEnd, gEnd]) {
    if (end.status === "rejected" && isUnknownBlock(end.reason)) throw end.reason;
    if (end.status !== "rejected" || classify(end.reason) !== "revert") return null;
  }
  if (typeof answer.value !== "string" || !isHex(answer.value)) return null;
  let results: readonly { success: boolean; returnData: Hex }[];
  try {
    results = decodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      data: answer.value,
    }) as readonly { success: boolean; returnData: Hex }[];
  } catch {
    return null;
  }
  if (results.length !== calls.length) return null;
  const values: unknown[] = [];
  for (const [i, call] of calls.entries()) {
    const result = results[i];
    if (!result?.success || result.returnData === "0x") return null;
    try {
      values.push(
        decodeFunctionResult({
          abi: call.abi,
          functionName: call.functionName,
          data: result.returnData,
        } as never)
      );
    } catch {
      return null;
    }
  }
  let at = 0;
  const take = (n: number) => {
    const part = values.slice(at, at + n);
    at += n;
    return part;
  };
  const [scAddress, gAddress, eubAddress, frozenUntil, freezeStatus] = take(PUH_GETTERS.length);
  const sc = getAddress(scAddress as Address);
  const g = getAddress(gAddress as Address);
  const eub = getAddress(eubAddress as Address);
  // The handler names other contracts now: the guess read the wrong ones.
  if (
    !isAddressEqual(sc, guess.sc) ||
    !isAddressEqual(g, guess.g) ||
    !isAddressEqual(eub, guess.eub)
  )
    return null;
  const scMembers = take(guess.scCount).map((m) => getAddress(m as Address));
  const gMembers = take(guess.gCount).map((m) => getAddress(m as Address));
  const [scDomain, gDomain, eubDomain] = take(3) as DomainAnswer[];
  return {
    puh,
    sc,
    g,
    eub,
    frozenUntil: frozenUntil as bigint,
    freezeStatus: freezeStatus as number,
    scMembers,
    gMembers,
    scDomain: scDomain ?? null,
    gDomain: gDomain ?? null,
    eubDomain: eubDomain ?? null,
    scValues: take(SC_GETTERS.length),
    gValues: take(G_GETTERS.length),
    eubValues: take(EUB_GETTERS.length),
  };
}

/** The domain to sign with, and the warning its answer calls for (if any). */
function domainOf(
  answer: DomainAnswer,
  address: Address,
  fallbackName: string,
  chainId: number,
  warnings: string[]
): Eip712Domain {
  // Only a contract that reverts on eip712Domain() gets the assumed domain. An RPC failure fails
  // the read: a guessed domain would change every digest members are shown.
  if (!answer) {
    warnings.push(
      `${fallbackName} at ${address} has no eip712Domain(); assuming ("${fallbackName}", "1")`
    );
    return { name: fallbackName, version: "1", chainId, verifyingContract: address };
  }
  const [, name, version, domainChainId, verifyingContract] = answer;
  if (Number(domainChainId) !== chainId || !isAddressEqual(verifyingContract, address)) {
    warnings.push(
      `${fallbackName} at ${address} reports EIP-712 domain chainId ${domainChainId} / ${verifyingContract}`
    );
  }
  return { name, version, chainId, verifyingContract: address };
}

/** The Governance a set of reads at `at` describes, with every check's warnings. */
function shape(net: Network, at: BlockRef, reads: Reads): Governance {
  const warnings: string[] = [];
  const { puh, sc, g, eub } = reads;
  const scDomain = domainOf(reads.scDomain, sc, "SecurityCouncil", net.chainId, warnings);
  const gDomain = domainOf(reads.gDomain, g, "Guardians", net.chainId, warnings);
  const eubDomain = domainOf(reads.eubDomain, eub, "EmergencyUpgradeBoard", net.chainId, warnings);
  const [scEip1271, scApprove, scSoft, scSoftConservative, scHard, scUnfreeze, ...scRest] =
    reads.scValues as bigint[];
  const [softNonce, hardNonce, unfreezeNonce, thresholdNonce, scHandler] = scRest as [
    bigint,
    bigint,
    bigint,
    bigint,
    Address,
  ];
  const [gEip1271, gApprove, gVeto, gCancel, gNonce, gHandler] = reads.gValues as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    Address,
  ];
  const [zkFoundation, eubSc, eubG, eubHandler] = reads.eubValues as Address[];

  const expect = (what: string, actual: Address, expected: Address) => {
    if (!isAddressEqual(actual, expected))
      warnings.push(`${what} is ${actual}, expected ${expected}`);
  };
  expect("SecurityCouncil.PROTOCOL_UPGRADE_HANDLER", scHandler, puh);
  expect("Guardians.PROTOCOL_UPGRADE_HANDLER", gHandler, puh);
  expect("EmergencyUpgradeBoard.PROTOCOL_UPGRADE_HANDLER", eubHandler as Address, puh);
  expect("EmergencyUpgradeBoard.SECURITY_COUNCIL", eubSc as Address, sc);
  expect("EmergencyUpgradeBoard.GUARDIANS", eubG as Address, g);
  if (reads.scMembers.length === 0) warnings.push(`SecurityCouncil ${sc} reports no members`);
  if (reads.gMembers.length === 0) warnings.push(`Guardians ${g} reports no members`);

  return {
    network: {
      name: net.name,
      label: net.label,
      chainId: net.chainId,
      explorerUrl: net.explorerUrl,
      l2ExplorerUrl: net.l2ExplorerUrl,
      tallyUrl: net.tallyUrl,
      isDevNode: net.isDevNode,
      overrides: net.overrides,
      standardLegalVetoDays: net.standardLegalVetoDays,
      safeWalletPrefix: net.safeWalletPrefix,
    },
    upgradeHandler: puh,
    securityCouncil: {
      address: sc,
      domain: scDomain,
      members: reads.scMembers,
      eip1271Threshold: Number(scEip1271),
      thresholds: {
        approveUpgrade: Number(scApprove),
        softFreeze: Number(scSoft),
        softFreezeConservative: Number(scSoftConservative),
        hardFreeze: Number(scHard),
        unfreeze: Number(scUnfreeze),
      },
      nonces: {
        softFreeze: softNonce.toString(),
        hardFreeze: hardNonce.toString(),
        unfreeze: unfreezeNonce.toString(),
        setSoftFreezeThreshold: thresholdNonce.toString(),
      },
    },
    guardians: {
      address: g,
      domain: gDomain,
      members: reads.gMembers,
      eip1271Threshold: Number(gEip1271),
      thresholds: {
        approveUpgrade: Number(gApprove),
        extendLegalVeto: Number(gVeto),
        cancelL2Proposal: Number(gCancel),
      },
      nonce: gNonce.toString(),
    },
    emergencyUpgradeBoard: {
      address: eub,
      domain: eubDomain,
      zkFoundation: getAddress(zkFoundation as Address),
    },
    freeze: {
      protocolFrozenUntil: reads.frozenUntil.toString(),
      lastFreezeStatus: Number(reads.freezeStatus),
    },
    latestBlock: { number: at.number.toString(), timestamp: at.timestamp.toString() },
    warnings,
  } satisfies Governance;
}

// Today's bound for roles, thresholds and warnings. The sync engine re-reads them on every new
// block while the app is in use (replacing the entry), so requests then never wait on this read.
export const GOVERNANCE_KEY = "governance";
export const GOVERNANCE_TTL_MS = 30_000;

export function governance(): Promise<Governance> {
  return cached(GOVERNANCE_KEY, GOVERNANCE_TTL_MS, readGovernance);
}

// A backend behind the one that named the head does not know it yet; the next one usually does.
const UNKNOWN_BLOCK_RETRY_MS = 300;

/**
 * Reads everything governance() serves, now (uncached), at one block: `head` (the sync engine's
 * new head, before it is published), else the cached head. Every getter is read at that block's
 * number (at 'latest' on a dev node, whose state can change without a new block), in one round
 * when the last read's layout still holds (readInOne), else in rounds as before (readInRounds);
 * either way the same reads, and the same answer. Asked once more after a moment when the node
 * says it does not know the block (a load-balanced backend behind).
 */
export async function readGovernance(head?: BlockRef): Promise<Governance> {
  const [net, at] = await Promise.all([network(), head ?? latestBlock()]);
  try {
    return await readAt(net, at);
  } catch (error) {
    if (!isUnknownBlock(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, UNKNOWN_BLOCK_RETRY_MS));
    return readAt(net, at);
  }
}

async function readAt(net: Network, at: BlockRef): Promise<Governance> {
  const epoch = layoutEpoch;
  const guess = layout && isAddressEqual(layout.puh, net.upgradeHandler) ? layout : null;
  const blockNumber = net.isDevNode ? undefined : at.number;
  const reads =
    (guess && (await readInOne(net, blockNumber, guess))) || (await readInRounds(net, blockNumber));
  if (epoch === layoutEpoch)
    layout = {
      puh: reads.puh,
      sc: reads.sc,
      g: reads.g,
      eub: reads.eub,
      scCount: reads.scMembers.length,
      gCount: reads.gMembers.length,
    };
  return shape(net, at, reads);
}

export type SafeInfo = {
  address: Address;
  isContract: boolean;
  version: string | null;
  threshold: number | null;
  owners: Address[];
  // Safe's own domainSeparator() equals the one this app computes (catches pre-1.3.0 Safes).
  domainSeparatorMatches: boolean | null;
};

export const SAFE_INFO_TTL_MS = 5 * 60_000;
export const safeInfoKey = (address: Address) => `safe-info:${address.toLowerCase()}`;

export function safeInfo(address: Address): Promise<SafeInfo> {
  return cached(safeInfoKey(address), SAFE_INFO_TTL_MS, () => readSafeInfo(address));
}

/** Reads what safeInfo() serves, now (uncached). */
export async function readSafeInfo(address: Address): Promise<SafeInfo> {
  const { chainId } = await network();
  const code = await l1.getCode({ address });
  if (!code || code === "0x") {
    return {
      address,
      isContract: false,
      version: null,
      threshold: null,
      owners: [],
      domainSeparatorMatches: null,
    };
  }
  // A getter the contract does not have (it reverts) reads as null. An RPC failure fails the
  // read instead: a threshold lost to a flaky RPC would turn a Safe still collecting
  // signatures into an invalid one.
  const optional = <T>(functionName: string) =>
    confirmedRead<T>(address, safeAbi, functionName).catch(orNullOnRevert);
  const [version, threshold, owners, separator] = await Promise.all([
    optional<string>("VERSION"),
    optional<bigint>("getThreshold"),
    optional<Address[]>("getOwners"),
    optional<`0x${string}`>("domainSeparator"),
  ]);
  const expected = safeMessageHashes(chainId, address, zeroHash).domainHash;
  return {
    address,
    isContract: true,
    version,
    threshold: threshold === null ? null : Number(threshold),
    owners: owners === null ? [] : owners.map((o) => getAddress(o)),
    domainSeparatorMatches: separator === null ? null : separator === expected,
  };
}
