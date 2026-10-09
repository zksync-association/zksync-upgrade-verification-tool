import type { CodePins } from "@/common/networks";
import { type Address, type Hex, isHex, keccak256 } from "viem";
import { FOREVER, cached } from "../cache";
import { lanes, network, rpcGeneration } from "../rpc";

// The code the app relies on (common/networks.ts CodePins), checked once per process: the hash of
// an address's runtime code is read the first time it matters and kept for the settings
// generation (code at an address can only appear, never change, for the pinned contracts: none
// of them can SELFDESTRUCT, and EIP-6780 limits it to the creating transaction anyway). Mainnet
// only: Sepolia, local chains and any overridden trust anchor (governance.network.overrides) have
// no pins, so nothing relies on them there.

let testPins: CodePins | null | undefined;

// Whether a check of pinned code that runs on its own, a moment after something needed it
// (governance.ts pinsChecked), may send its reads now. sync/engine.ts sets it: while someone uses
// the app or the engine follows the chain (R-D3: nothing reads once use has ended). Not allowed:
// nothing is read, and the next need starts the check again. Unset (no engine in this process,
// e.g. a script): allowed.
let backgroundChecksAllowed: () => boolean = () => true;

/** Sets when a pin check running on its own may send its reads (see above); returns the last. */
export function allowPinChecksWhen(allowed: () => boolean): () => boolean {
  const previous = backgroundChecksAllowed;
  backgroundChecksAllowed = allowed;
  return previous;
}

/** Whether a pin check running on its own may send its reads now (see above). */
export function pinChecksAllowed(): boolean {
  return backgroundChecksAllowed();
}

/** Tests: pins in place of the network's (undefined: the network's again). */
export function overrideCodePinsForTests(pins: CodePins | null | undefined) {
  testPins = pins;
}

/** The pins that apply under the current settings, or null when none do. */
export async function codePins(): Promise<CodePins | null> {
  if (testPins !== undefined) return testPins;
  const net = await network();
  if (net.isDevNode || (net.overrides?.length ?? 0) > 0) return null;
  return net.codePins ?? null;
}

/**
 * keccak256 of the runtime code at `address` ('latest'), read once per settings generation;
 * null for no code. Rejects when it cannot be read (asked again next time).
 */
export function codeHashOf(address: Address): Promise<Hex | null> {
  return cached(`code-hash:${rpcGeneration()}:${address.toLowerCase()}`, FOREVER, async () => {
    const code = await lanes().call.request<unknown>("eth_getCode", [address, "latest"]);
    if (typeof code !== "string" || !isHex(code)) throw new Error(`No code read for ${address}`);
    return code === "0x" || code === "0x0" ? null : keccak256(code);
  });
}

/**
 * Whether `address` runs one of the `allowed` code hashes: a definite answer (false for other code
 * or none). Rejects when its code cannot be read, so a caller that keeps the answer can tell
 * "not pinned" from "not known yet" and ask again later.
 */
export async function runsPinnedCode(address: Address, allowed: readonly Hex[]): Promise<boolean> {
  const hash = await codeHashOf(address);
  return hash !== null && allowed.some((pin) => pin.toLowerCase() === hash.toLowerCase());
}

/**
 * Whether `address` runs one of the `allowed` code hashes. false (never an error) when its code
 * cannot be read: whatever relies on the pin then reads as without it, this time (the read is
 * asked again the next time).
 */
export async function hasPinnedCode(address: Address, allowed: readonly Hex[]): Promise<boolean> {
  return runsPinnedCode(address, allowed).catch(() => false);
}
