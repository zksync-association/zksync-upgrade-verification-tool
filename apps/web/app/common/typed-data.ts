import {
  type Address,
  type Hex,
  getAddress,
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  hashTypedData,
} from "viem";

// Every governance signature is EIP-712 typed data over one of these primary types. They mirror the
// TYPEHASH constants in SecurityCouncil.sol, Guardians.sol and EmergencyUpgradeBoard.sol.

export type SignerGroup = "securityCouncil" | "guardians" | "zkFoundation";
export type Verifier = "securityCouncil" | "guardians" | "emergencyUpgradeBoard";

type Field = { readonly name: string; readonly type: "bytes32" | "uint256" | "address" };

const ID = [{ name: "id", type: "bytes32" }] as const satisfies readonly Field[];
const FREEZE = [
  { name: "nonce", type: "uint256" },
  { name: "validUntil", type: "uint256" },
] as const satisfies readonly Field[];

export const ACTIONS = {
  ApproveUpgradeSecurityCouncil: {
    verifier: "securityCouncil",
    signers: "securityCouncil",
    fields: ID,
  },
  ApproveUpgradeGuardians: { verifier: "guardians", signers: "guardians", fields: ID },
  ExtendLegalVetoPeriod: { verifier: "guardians", signers: "guardians", fields: ID },
  ExecuteEmergencyUpgradeSecurityCouncil: {
    verifier: "emergencyUpgradeBoard",
    signers: "securityCouncil",
    fields: ID,
  },
  ExecuteEmergencyUpgradeGuardians: {
    verifier: "emergencyUpgradeBoard",
    signers: "guardians",
    fields: ID,
  },
  ExecuteEmergencyUpgradeZKFoundation: {
    verifier: "emergencyUpgradeBoard",
    signers: "zkFoundation",
    fields: ID,
  },
  SoftFreeze: { verifier: "securityCouncil", signers: "securityCouncil", fields: FREEZE },
  HardFreeze: { verifier: "securityCouncil", signers: "securityCouncil", fields: FREEZE },
  Unfreeze: { verifier: "securityCouncil", signers: "securityCouncil", fields: FREEZE },
  SetSoftFreezeThreshold: {
    verifier: "securityCouncil",
    signers: "securityCouncil",
    fields: [{ name: "threshold", type: "uint256" }, ...FREEZE],
  },
  CancelL2GovernorProposal: {
    verifier: "guardians",
    signers: "guardians",
    fields: [
      { name: "l2ProposalId", type: "uint256" },
      { name: "l2GovernorAddress", type: "address" },
      { name: "l2GasLimit", type: "uint256" },
      { name: "l2GasPerPubdataByteLimit", type: "uint256" },
      { name: "refundRecipient", type: "address" },
      { name: "txMintValue", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  },
} as const satisfies Record<
  string,
  { verifier: Verifier; signers: SignerGroup; fields: readonly Field[] }
>;

export type ActionName = keyof typeof ACTIONS;

export function isActionName(value: unknown): value is ActionName {
  return typeof value === "string" && Object.hasOwn(ACTIONS, value);
}

export type Eip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

// JSON-safe form (numbers as decimal strings), as sent to the browser and shown to signers.
export type GovernanceTypedData = {
  domain: Eip712Domain;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: ActionName;
  message: Record<string, string>;
};

export function buildTypedData(
  action: ActionName,
  domain: Eip712Domain,
  message: Record<string, string | bigint | number>
): GovernanceTypedData {
  const fields = ACTIONS[action].fields;
  const normalized: Record<string, string> = {};
  for (const field of fields) {
    const value = message[field.name];
    if (value === undefined) throw new Error(`Missing ${field.name} for ${action}`);
    normalized[field.name] = typeof value === "string" ? value : value.toString();
  }
  return {
    domain,
    types: { [action]: fields.map((f) => ({ name: f.name, type: f.type })) },
    primaryType: action,
    message: normalized,
  };
}

/** The same typed data with uint fields as bigint, as viem and wallets expect for signing. */
export function toSignable(typedData: GovernanceTypedData) {
  const fields = ACTIONS[typedData.primaryType].fields;
  const message: Record<string, string | bigint> = {};
  for (const field of fields) {
    const value = typedData.message[field.name] as string;
    message[field.name] = field.type === "uint256" ? BigInt(value) : value;
  }
  return {
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message,
  };
}

export type GovernanceHashes = {
  domainSeparator: Hex;
  structHash: Hex;
  digest: Hex;
};

export function governanceHashes(typedData: GovernanceTypedData): GovernanceHashes {
  const signable = toSignable(typedData);
  return {
    domainSeparator: hashDomain({
      domain: typedData.domain,
      types: { EIP712Domain: getTypesForEIP712Domain({ domain: typedData.domain }) },
    }),
    structHash: hashStruct({
      data: signable.message,
      primaryType: typedData.primaryType,
      types: typedData.types,
    }),
    digest: hashTypedData(signable as Parameters<typeof hashTypedData>[0]),
  };
}

/**
 * Parses the typed data a Safe stores for a message. Returns null unless it is exactly one of the
 * governance actions (same fields, same order, same types) on the expected chain.
 */
export function parseGovernanceTypedData(
  raw: unknown,
  chainId: number
): GovernanceTypedData | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as {
    types?: Record<string, { name: string; type: string }[]>;
    domain?: Record<string, unknown>;
    primaryType?: unknown;
    message?: Record<string, unknown>;
  };
  if (!isActionName(data.primaryType) || !data.types || !data.domain || !data.message) return null;
  const action = data.primaryType;
  const expected = ACTIONS[action].fields;
  const actual = data.types[action];
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((f, i) => f.name !== expected[i]?.name || f.type !== expected[i]?.type)
  ) {
    return null;
  }
  const { name, version, chainId: rawChainId, verifyingContract } = data.domain;
  if (
    typeof name !== "string" ||
    typeof version !== "string" ||
    Number(rawChainId) !== chainId ||
    typeof verifyingContract !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(verifyingContract)
  ) {
    return null;
  }
  const message: Record<string, string> = {};
  for (const field of expected) {
    const value = data.message[field.name];
    if (typeof value !== "string" && typeof value !== "number") return null;
    const text = String(value);
    if (field.type === "uint256" && !/^\d+$/.test(text)) return null;
    if (field.type === "bytes32" && !/^0x[0-9a-fA-F]{64}$/.test(text)) return null;
    if (field.type === "address" && !/^0x[0-9a-fA-F]{40}$/.test(text)) return null;
    message[field.name] =
      field.type === "address"
        ? getAddress(text)
        : field.type === "bytes32"
          ? text.toLowerCase()
          : text;
  }
  return buildTypedData(
    action,
    { name, version, chainId, verifyingContract: getAddress(verifyingContract) },
    message
  );
}
