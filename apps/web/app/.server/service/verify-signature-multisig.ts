import { type AbiFunction, hashTypedData, type Hex, verifyTypedData } from "viem";
import type { SignAction } from "@/common/sign-action";
import { badRequest } from "@/utils/http";
import { l1Rpc } from "./ethereum-l1/client";
import guardiansArtifact from "@repo/contracts/artifacts/Guardians/Guardians.json";
import type { Guardians$Type } from "@repo/contracts/artifacts/Guardians/Guardians.d.ts";
import { EthereumConfig } from "@config/ethereum.server";

function createTypedDigest({
  verifierAddr,
  action,
  contractName,
  types,
  message,
}: {
  verifierAddr: Hex;
  action: SignAction;
  contractName: string;
  types: { name: string; type: string }[];
  message: { [_key: string]: any };
}) {
  return hashTypedData({
    domain: {
      name: contractName,
      version: "1",
      chainId: EthereumConfig.l1.chainId,
      verifyingContract: verifierAddr,
    },
    primaryType: action,
    message,
    types: {
      [action]: types,
    },
  });
}

export async function assertValidSignatureZkFoundation(
  foundationAddress: Hex,
  signature: Hex,
  verifierAddr: Hex,
  action: SignAction,
  message: Record<string, string>,
  types: { name: string; type: string }[],
  contractName: string
): Promise<void> {
  const digest = createTypedDigest({
    verifierAddr,
    action,
    message,
    types,
    contractName,
  });
  const code = await l1Rpc.getCode({ address: foundationAddress });

  if (code === undefined) {
    const isValid = await verifyTypedData({
      domain: {
        name: contractName,
        version: "1",
        chainId: EthereumConfig.l1.chainId,
        verifyingContract: verifierAddr,
      },
      primaryType: action,
      message,
      types: {
        [action]: types,
      },
      signature,
      address: foundationAddress,
    });

    if (!isValid) {
      throw badRequest("Invalid signature");
    }
    return;
  }

  const IERC1271Abi = {
    name: "isValidSignature",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
    type: "function",
    stateMutability: "view",
  } satisfies AbiFunction;

  const isValid = await l1Rpc.readContract({
    abi: [IERC1271Abi],
    address: foundationAddress,
    functionName: "isValidSignature",
    args: [digest, signature],
  });
  if (!isValid) {
    throw badRequest("Invalid signature");
  }
}

type VerifySignatureArgs = {
  signer: Hex;
  signature: Hex;
  verifierAddr: Hex;
  action: SignAction;
  contractName: string;
  types: { name: string; type: string }[];
  message: { [_key: string]: any };
  targetContract: Hex;
};

export async function verifySignatureMultisig({
  signer,
  signature,
  verifierAddr,
  action,
  contractName,
  types,
  message,
  targetContract,
}: VerifySignatureArgs) {
  const digest = createTypedDigest({
    verifierAddr,
    action,
    message,
    types,
    contractName,
  });

  const guardiansAbi = guardiansArtifact.abi as Guardians$Type["abi"];

  try {
    await l1Rpc.readContract({
      address: targetContract,
      abi: guardiansAbi,
      functionName: "checkSignatures",
      args: [digest, [signer], [signature], 1n],
    });
    return true;
  } catch {
    return false;
  }
}

export async function assertSignatureIsValidMultisig(args: VerifySignatureArgs): Promise<void> {
  const isValid = await verifySignatureMultisig(args);
  if (!isValid) {
    throw badRequest("Invalid signature");
  }
}
