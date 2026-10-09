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

/**
 * A small JSON body a page POSTs (a beat, Fetch signatures), as text: null when it declares, or
 * turns out to have, more than `max` bytes (the rest is never read, so a large body is never
 * buffered).
 */
export async function readBodyAtMost(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
