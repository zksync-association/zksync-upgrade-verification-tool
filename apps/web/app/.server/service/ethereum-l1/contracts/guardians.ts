import { getContract, type Address, type Hex } from "viem";

import { l1Rpc } from "../client";
import { guardiansAddress } from "./protocol-upgrade-handler";
import { guardiansAbi } from "@/utils/contract-abis";

const guardians = (address: Address) =>
  getContract({
    address,
    abi: guardiansAbi,
    client: l1Rpc,
  });

const GUARDIAN_MEMBERS_COUNT = 8;

export async function withGuardiansAddress<T, A extends unknown[]>(
  fn: (guardiansAddress: Address, ...args: A) => Promise<T>,
  ...args: A
) {
  const guardiansAddr = await guardiansAddress();
  return fn(guardiansAddr, ...args);
}

export async function guardianMembers(guardiansAddress: Address): Promise<Address[]> {
  const contract = guardians(guardiansAddress);

  const memberPromises = Array.from({ length: GUARDIAN_MEMBERS_COUNT }, (_, i) =>
    contract.read.members([BigInt(i)])
  );

  return Promise.all(memberPromises);
}

export async function getGuardiansL2VetoNonce(guardiansAddress: Address) {
  const contract = guardians(guardiansAddress);
  return contract.read.nonce();
}

export async function checkSignatures(
  guardiansAddress: Address,
  {
    digest,
    signer,
    signatures,
    threshold,
  }: { digest: Hex; signer: Hex[]; signatures: Hex[]; threshold: bigint }
) {
  const contract = guardians(guardiansAddress);
  return contract.read.checkSignatures([digest, signer, signatures, threshold]);
}
