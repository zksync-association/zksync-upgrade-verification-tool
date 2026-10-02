import type { MemberSignature } from "@/common/execution";
import { type Hex, getAddress } from "viem";

/**
 * Extra signatures passed as ?sig=<member>:<signature> (repeatable), for signatures that exist
 * outside the Safe Transaction Service. They are verified on-chain like any other and never stored.
 */
export function suppliedSignatures(request: Request): MemberSignature[] {
  const url = new URL(request.url);
  return url.searchParams
    .getAll("sig")
    .slice(0, 32)
    .flatMap((value) => {
      const [signer, signature] = value.split(":");
      if (!signer || !/^0x[0-9a-fA-F]{40}$/.test(signer)) return [];
      if (signature === undefined || !/^0x([0-9a-fA-F]{2})*$/.test(signature)) return [];
      return [{ signer: getAddress(signer), signature: signature as Hex }];
    });
}

export const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
