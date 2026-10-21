// node:crypto for the single-file build: sha256 hex digests and random bytes, as the app uses them.
import { sha256, toBytes } from "viem";

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`createHash(${algorithm}) is not available here`);
  const parts: Uint8Array[] = [];
  const hash = {
    update(part: string | Uint8Array) {
      parts.push(typeof part === "string" ? toBytes(part) : part);
      return hash;
    },
    digest(encoding: string) {
      if (encoding !== "hex") throw new Error(`digest(${encoding}) is not available here`);
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        all.set(p, at);
        at += p.length;
      }
      return sha256(all).slice(2);
    },
  };
  return hash;
}

export function randomBytes(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return {
    toString: (encoding: string) =>
      encoding === "hex"
        ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
        : String(bytes),
  };
}
