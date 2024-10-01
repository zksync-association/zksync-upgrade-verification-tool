import { getContract, type Address, type Hex } from "viem";

import { l1Rpc } from "../client";
import { guardiansAbi } from "@/utils/contract-abis";
import { guardiansAddress } from "./protocol-upgrade-handler";

const guardians = (address: Address) =>
  getContract({
    address,
    abi: guardiansAbi,
    client: l1Rpc,
  });

const GUARDIAN_MEMBERS_COUNT = 8;

export async function guardianMembers(guardiansAddress?: Address): Promise<Address[]> {
  const address = await guardianAddressOrDefault(guardiansAddress);
  const contract = guardians(address);

  const memberPromises = Array.from({ length: GUARDIAN_MEMBERS_COUNT }, (_, i) =>
    contract.read.members([BigInt(i)])
  );

  return Promise.all(memberPromises);
}

export async function getGuardiansL2VetoNonce(guardiansAddress?: Address) {
  const address = await guardianAddressOrDefault(guardiansAddress);
  const contract = guardians(address);
  return contract.read.nonce();
}

export async function checkSignatures(
  {
    digest,
    signer,
    signatures,
    threshold,
  }: { digest: Hex; signer: Hex[]; signatures: Hex[]; threshold: bigint },
  guardiansAddress?: Address
) {
  const address = await guardianAddressOrDefault(guardiansAddress);
  const contract = guardians(address);
  return contract.read.checkSignatures([digest, signer, signatures, threshold]);
}

async function guardianAddressOrDefault(address?: Address) {
  return address ?? (await guardiansAddress());
}
