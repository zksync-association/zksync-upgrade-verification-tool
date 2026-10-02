import {
  type Address,
  type Hex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  size,
  slice,
} from "viem";
import { z } from "zod";

export type Call = { target: Address; value: string; data: Hex };
export type UpgradeProposal = { calls: Call[]; executor: Address; salt: Hex };

const upgradeProposalAbi = [
  {
    type: "tuple",
    components: [
      {
        type: "tuple[]",
        name: "calls",
        components: [
          { type: "address", name: "target" },
          { type: "uint256", name: "value" },
          { type: "bytes", name: "data" },
        ],
      },
      { type: "address", name: "executor" },
      { type: "bytes32", name: "salt" },
    ],
  },
] as const;

/** keccak256(abi.encode(UpgradeProposal)) — the id ProtocolUpgradeHandler and every signer use. */
export function upgradeProposalId(proposal: UpgradeProposal): Hex {
  return keccak256(encodeUpgradeProposal(proposal));
}

export function encodeUpgradeProposal(proposal: UpgradeProposal): Hex {
  return encodeAbiParameters(upgradeProposalAbi, [
    {
      calls: proposal.calls.map((c) => ({
        target: c.target,
        value: BigInt(c.value),
        data: c.data,
      })),
      executor: proposal.executor,
      salt: proposal.salt,
    },
  ]);
}

/** Decodes abi.encode(UpgradeProposal), e.g. the body of the L2 → L1 message. */
export function decodeUpgradeProposal(encoded: Hex): UpgradeProposal {
  const [decoded] = decodeAbiParameters(upgradeProposalAbi, encoded);
  return fromAbi(decoded);
}

export function fromAbi(decoded: {
  calls: readonly { target: Address; value: bigint; data: Hex }[];
  executor: Address;
  salt: Hex;
}): UpgradeProposal {
  return {
    calls: decoded.calls.map((c) => ({
      target: getAddress(c.target),
      value: c.value.toString(),
      data: c.data,
    })),
    executor: getAddress(decoded.executor),
    salt: decoded.salt,
  };
}

// Functions commonly found in governance upgrades. A match is shown only if re-encoding the
// decoded arguments reproduces the calldata byte for byte. Anything else is shown raw:
// deep analysis of protocol upgrades is the CLI's job (apps/cli).
const knownFunctions = parseAbi([
  "function upgrade(address proxy, address implementation)",
  "function upgradeAndCall(address proxy, address implementation, bytes data)",
  "function upgradeTo(address newImplementation)",
  "function upgradeToAndCall(address newImplementation, bytes data)",
  "function changeProxyAdmin(address proxy, address newAdmin)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function acceptAdmin()",
  "function setPendingAdmin(address newPendingAdmin)",
  "function updateSecurityCouncil(address _newSecurityCouncil)",
  "function updateGuardians(address _newGuardians)",
  "function updateEmergencyUpgradeBoard(address _newEmergencyUpgradeBoard)",
  "function freezeChain(uint256 _chainId)",
  "function unfreezeChain(uint256 _chainId)",
  "function pause()",
  "function unpause()",
  "function setValidatorTimelock(address addr)",
  "function setPorterAvailability(bool _zkPorterIsAvailable)",
  "function setPriorityTxMaxGasLimit(uint256 _newPriorityTxMaxGasLimit)",
  "function setTokenMultiplier(uint128 _nominator, uint128 _denominator)",
]);

export type DecodedCall = Call & {
  selector: Hex | null;
  decoded: { signature: string; args: { name: string; type: string; value: string }[] } | null;
};

export function decodeCall(call: Call): DecodedCall {
  const selector = size(call.data) >= 4 ? slice(call.data, 0, 4) : null;
  try {
    const { functionName, args } = decodeFunctionData({ abi: knownFunctions, data: call.data });
    const item = knownFunctions.find(
      (f) => f.name === functionName && f.inputs.length === (args?.length ?? 0)
    );
    if (!item) return { ...call, selector, decoded: null };
    const reencoded = encodeFunctionData({
      abi: [item],
      functionName,
      args: args as never,
    } as Parameters<typeof encodeFunctionData>[0]);
    if (reencoded.toLowerCase() !== call.data.toLowerCase()) {
      return { ...call, selector, decoded: null };
    }
    return {
      ...call,
      selector,
      decoded: {
        signature: `${functionName}(${item.inputs.map((i) => i.type).join(",")})`,
        args: item.inputs.map((input, i) => ({
          name: input.name ?? `arg${i}`,
          type: input.type,
          value: String((args as readonly unknown[])[i]),
        })),
      },
    };
  } catch {
    return { ...call, selector, decoded: null };
  }
}

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex string");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an address");
const hexBytes = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "must be 0x-prefixed hex bytes");
const uint = z.union([z.string(), z.number().int().nonnegative()]).transform((v, ctx) => {
  try {
    const n = BigInt(v);
    if (n < 0n) throw new Error();
    return n.toString();
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a non-negative integer" });
    return z.NEVER;
  }
});

// What an emergency proposer shares with signers out of band: Safe only stores the id.
export const emergencyPayloadSchema = z.object({
  title: z.string().optional(),
  executor: address.optional(),
  salt: bytes32,
  calls: z.array(z.object({ target: address, value: uint.default("0"), data: hexBytes })).min(1),
});

export type EmergencyPayload = z.infer<typeof emergencyPayloadSchema>;

export type PayloadCheck =
  | { ok: true; proposal: UpgradeProposal; id: Hex; title: string | null }
  | { ok: false; error: string; id?: Hex };

/** Parses a payload and checks it hashes to the signed id with the Emergency Upgrade Board as executor. */
export function checkEmergencyPayload(raw: unknown, expectedId: Hex, board: Address): PayloadCheck {
  const parsed = emergencyPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `Invalid payload: ${issue?.path.join(".") || "root"} ${issue?.message}`,
    };
  }
  if (parsed.data.executor && getAddress(parsed.data.executor) !== getAddress(board)) {
    return {
      ok: false,
      error: `Payload executor ${parsed.data.executor} is not the Emergency Upgrade Board ${board}`,
    };
  }
  const proposal: UpgradeProposal = {
    calls: parsed.data.calls.map((c) => ({
      target: getAddress(c.target),
      value: c.value,
      data: c.data as Hex,
    })),
    executor: getAddress(board),
    salt: parsed.data.salt as Hex,
  };
  const id = upgradeProposalId(proposal);
  if (id.toLowerCase() !== expectedId.toLowerCase()) {
    return { ok: false, id, error: `Payload hashes to ${id}, not to the signed id ${expectedId}` };
  }
  return { ok: true, proposal, id, title: parsed.data.title ?? null };
}
