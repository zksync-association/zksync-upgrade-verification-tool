import {
  emergencyUpgradeBoardAbi,
  guardiansAbi,
  safeAbi,
  securityCouncilAbi,
  upgradeHandlerAbi,
} from "@/common/abis";
import { safeMessageHashes } from "@/common/safe";
import type { Eip712Domain } from "@/common/typed-data";
import { type Abi, type Address, getAddress, isAddressEqual, zeroHash } from "viem";
import { cached } from "./cache";
import { callFn, classify } from "./chain/call";
import { readMemberList } from "./member-list";
import { type Network, l1, latestBlock, network } from "./rpc";

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

const read = <T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) =>
  l1.readContract({ address, abi, functionName, args }) as Promise<T>;

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
  args: readonly unknown[] = []
): Promise<T> {
  try {
    return await read<T>(address, abi, functionName, args);
  } catch {
    return callFn<T>({ address, abi, functionName, args });
  }
}

/** The direct read's answer to "is this getter missing?": null on a definite revert. */
const orNullOnRevert = (error: unknown) => {
  if (classify(error) === "revert") return null;
  throw error;
};

async function readMembers(address: Address, abi: Abi): Promise<Address[]> {
  // Batched reads; only the first index that fails is asked again directly. Past the end of the
  // list every read fails, and one direct answer (a definite revert) is enough.
  return readMemberList(
    (index) => read<Address>(address, abi, "members", [index]),
    (index) => callFn<Address>({ address, abi, functionName: "members", args: [index] })
  );
}

async function readDomain(
  address: Address,
  abi: Abi,
  fallbackName: string,
  chainId: number,
  warnings: string[]
): Promise<Eip712Domain> {
  const domain = await confirmedRead<[string, string, string, bigint, Address]>(
    address,
    abi,
    "eip712Domain"
  ).catch(orNullOnRevert);
  // Only a contract that reverts on eip712Domain() gets the assumed domain. An RPC failure fails
  // the read: a guessed domain would change every digest members are shown.
  if (!domain) {
    warnings.push(
      `${fallbackName} at ${address} has no eip712Domain(); assuming ("${fallbackName}", "1")`
    );
    return { name: fallbackName, version: "1", chainId, verifyingContract: address };
  }
  const [, name, version, domainChainId, verifyingContract] = domain;
  if (Number(domainChainId) !== chainId || !isAddressEqual(verifyingContract, address)) {
    warnings.push(
      `${fallbackName} at ${address} reports EIP-712 domain chainId ${domainChainId} / ${verifyingContract}`
    );
  }
  return { name, version, chainId, verifyingContract: address };
}

export function governance(): Promise<Governance> {
  return cached("governance", 30_000, async () => {
    const net = await network();
    const puh = net.upgradeHandler;
    const warnings: string[] = [];

    const code = await l1.getCode({ address: puh });
    if (!code || code === "0x") {
      throw new Error(`No contract at ProtocolUpgradeHandler ${puh} on chain ${net.chainId}`);
    }

    const [scAddress, gAddress, eubAddress, frozenUntil, freezeStatus, block] = await Promise.all([
      read<Address>(puh, upgradeHandlerAbi, "securityCouncil"),
      read<Address>(puh, upgradeHandlerAbi, "guardians"),
      read<Address>(puh, upgradeHandlerAbi, "emergencyUpgradeBoard"),
      read<bigint>(puh, upgradeHandlerAbi, "protocolFrozenUntil"),
      read<number>(puh, upgradeHandlerAbi, "lastFreezeStatusInUpgradeCycle"),
      latestBlock(),
    ]);
    const sc = getAddress(scAddress);
    const g = getAddress(gAddress);
    const eub = getAddress(eubAddress);

    const scRead = <T>(fn: string) => read<T>(sc, securityCouncilAbi, fn);
    const gRead = <T>(fn: string) => read<T>(g, guardiansAbi, fn);
    const eubRead = <T>(fn: string) => read<T>(eub, emergencyUpgradeBoardAbi, fn);

    const [scMembers, gMembers, scDomain, gDomain, eubDomain, scValues, gValues, eubValues] =
      await Promise.all([
        readMembers(sc, securityCouncilAbi),
        readMembers(g, guardiansAbi),
        readDomain(sc, securityCouncilAbi, "SecurityCouncil", net.chainId, warnings),
        readDomain(g, guardiansAbi, "Guardians", net.chainId, warnings),
        readDomain(eub, emergencyUpgradeBoardAbi, "EmergencyUpgradeBoard", net.chainId, warnings),
        Promise.all([
          scRead<bigint>("EIP1271_THRESHOLD"),
          scRead<bigint>("APPROVE_UPGRADE_SECURITY_COUNCIL_THRESHOLD"),
          scRead<bigint>("softFreezeThreshold"),
          scRead<bigint>("SOFT_FREEZE_CONSERVATIVE_THRESHOLD"),
          scRead<bigint>("HARD_FREEZE_THRESHOLD"),
          scRead<bigint>("UNFREEZE_THRESHOLD"),
          scRead<bigint>("softFreezeNonce"),
          scRead<bigint>("hardFreezeNonce"),
          scRead<bigint>("unfreezeNonce"),
          scRead<bigint>("softFreezeThresholdSettingNonce"),
          scRead<Address>("PROTOCOL_UPGRADE_HANDLER"),
        ]),
        Promise.all([
          gRead<bigint>("EIP1271_THRESHOLD"),
          gRead<bigint>("APPROVE_UPGRADE_GUARDIANS_THRESHOLD"),
          gRead<bigint>("EXTEND_LEGAL_VETO_THRESHOLD"),
          gRead<bigint>("CANCEL_L2_GOVERNOR_PROPOSAL_THRESHOLD"),
          gRead<bigint>("nonce"),
          gRead<Address>("PROTOCOL_UPGRADE_HANDLER"),
        ]),
        Promise.all([
          eubRead<Address>("ZK_FOUNDATION_SAFE"),
          eubRead<Address>("SECURITY_COUNCIL"),
          eubRead<Address>("GUARDIANS"),
          eubRead<Address>("PROTOCOL_UPGRADE_HANDLER"),
        ]),
      ]);

    const [scEip1271, scApprove, scSoft, scSoftConservative, scHard, scUnfreeze, ...scRest] =
      scValues;
    const [softNonce, hardNonce, unfreezeNonce, thresholdNonce, scHandler] = scRest as [
      bigint,
      bigint,
      bigint,
      bigint,
      Address,
    ];
    const [gEip1271, gApprove, gVeto, gCancel, gNonce, gHandler] = gValues;
    const [zkFoundation, eubSc, eubG, eubHandler] = eubValues;

    const expect = (what: string, actual: Address, expected: Address) => {
      if (!isAddressEqual(actual, expected))
        warnings.push(`${what} is ${actual}, expected ${expected}`);
    };
    expect("SecurityCouncil.PROTOCOL_UPGRADE_HANDLER", scHandler, puh);
    expect("Guardians.PROTOCOL_UPGRADE_HANDLER", gHandler as Address, puh);
    expect("EmergencyUpgradeBoard.PROTOCOL_UPGRADE_HANDLER", eubHandler, puh);
    expect("EmergencyUpgradeBoard.SECURITY_COUNCIL", eubSc, sc);
    expect("EmergencyUpgradeBoard.GUARDIANS", eubG, g);
    if (scMembers.length === 0) warnings.push(`SecurityCouncil ${sc} reports no members`);
    if (gMembers.length === 0) warnings.push(`Guardians ${g} reports no members`);

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
        members: scMembers,
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
        members: gMembers,
        eip1271Threshold: Number(gEip1271),
        thresholds: {
          approveUpgrade: Number(gApprove),
          extendLegalVeto: Number(gVeto),
          cancelL2Proposal: Number(gCancel),
        },
        nonce: (gNonce as bigint).toString(),
      },
      emergencyUpgradeBoard: {
        address: eub,
        domain: eubDomain,
        zkFoundation: getAddress(zkFoundation),
      },
      freeze: {
        protocolFrozenUntil: frozenUntil.toString(),
        lastFreezeStatus: Number(freezeStatus),
      },
      latestBlock: { number: block.number.toString(), timestamp: block.timestamp.toString() },
      warnings,
    } satisfies Governance;
  });
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

export function safeInfo(address: Address): Promise<SafeInfo> {
  return cached(`safe-info:${address.toLowerCase()}`, 5 * 60_000, async () => {
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
  });
}
