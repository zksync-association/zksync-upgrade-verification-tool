import { type AbiFunction, hashTypedData, type Hex, verifyTypedData } from "viem";
import type { SignAction } from "@/common/sign-action";
import { l1Rpc } from "@/.server/service/clients";
import { env } from "@config/env.server";
import { mainnet, sepolia } from "wagmi/chains";
import { z } from "zod";
import { guardiansAbi } from "@/.server/service/contract-abis";
import { badRequest } from "@/utils/http";

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
      chainId: env.ETH_NETWORK === "mainnet" ? mainnet.id : sepolia.id,
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
  const code = await l1Rpc.getByteCode(foundationAddress);

  if (code === undefined) {
    const isValid = await verifyTypedData({
      domain: {
        name: contractName,
        version: "1",
        chainId: env.ETH_NETWORK === "mainnet" ? mainnet.id : sepolia.id,
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

  const IERC1271Abi: AbiFunction = {
    name: "isValidSignature",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
    type: "function",
    stateMutability: "view",
  };

  const isValid = await l1Rpc.contractRead(
    foundationAddress,
    "isValidSignature",
    [IERC1271Abi],
    z.any(),
    [digest, signature]
  );
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

  try {
    await l1Rpc.contractRead(targetContract, "checkSignatures", guardiansAbi.raw, z.any(), [
      digest,
      [signer],
      [signature],
      1,
    ]);
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
