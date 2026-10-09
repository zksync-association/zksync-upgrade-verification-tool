import type { CodePins } from "@/common/networks";
import { type Address, type Hex, isHex, keccak256 } from "viem";
import { FOREVER, cached } from "../cache";
import { lanes, network, rpcGeneration } from "../rpc";

// Runtime code hashes the app relies on (common/networks.ts CodePins), mainnet only: none on
// Sepolia, local chains or with an overridden trust anchor. Pinned contracts cannot SELFDESTRUCT,
// so a hash is read once per settings generation.

let testPins: CodePins | null | undefined;

// Whether a pin check running on its own may read now (sync/engine.ts sets it; unset: always).
let backgroundChecksAllowed: () => boolean = () => true;

/** Sets when a pin check running on its own may read; returns the previous rule. */
export function allowPinChecksWhen(allowed: () => boolean): () => boolean {
  const previous = backgroundChecksAllowed;
  backgroundChecksAllowed = allowed;
  return previous;
}

export function pinChecksAllowed(): boolean {
  return backgroundChecksAllowed();
}

/** Tests: pins in place of the network's (undefined: the network's again). */
export function overrideCodePinsForTests(pins: CodePins | null | undefined) {
  testPins = pins;
}

export async function codePins(): Promise<CodePins | null> {
  if (testPins !== undefined) return testPins;
  const net = await network();
  if (net.isDevNode || (net.overrides?.length ?? 0) > 0) return null;
  return net.codePins ?? null;
}

/** keccak256 of the code at `address` ('latest'), null for none; rejects when it cannot be read. */
function codeHashOf(address: Address): Promise<Hex | null> {
  return cached(`code-hash:${rpcGeneration()}:${address.toLowerCase()}`, FOREVER, async () => {
    const code = await lanes().call.request<unknown>("eth_getCode", [address, "latest"]);
    if (typeof code !== "string" || !isHex(code)) throw new Error(`No code read for ${address}`);
    return code === "0x" || code === "0x0" ? null : keccak256(code);
  });
}

/** Rejects when the code cannot be read, so callers tell "not pinned" from "not known yet". */
export async function runsPinnedCode(address: Address, allowed: readonly Hex[]): Promise<boolean> {
  const hash = await codeHashOf(address);
  return hash !== null && allowed.some((pin) => pin.toLowerCase() === hash.toLowerCase());
}

/** As runsPinnedCode, but false (never an error) when the code cannot be read. */
export async function hasPinnedCode(address: Address, allowed: readonly Hex[]): Promise<boolean> {
  return runsPinnedCode(address, allowed).catch(() => false);
}
