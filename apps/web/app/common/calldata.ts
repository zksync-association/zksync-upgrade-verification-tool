// Calldata decoding against a catalog of known functions (abi-catalog/functions.json, imported with
// scripts/import-abis.ts, plus a few hand-written ones), into a tree a page can show: tuples, arrays,
// and bytes that hold calldata of their own, decoded in turn. A decoding is used only when encoding
// its values again reproduces the bytes exactly, at every level; anything else stays raw bytes.
import {
  type AbiFunction,
  type AbiParameter,
  type Address,
  type Hex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  size,
  slice,
  toFunctionSelector,
} from "viem";
import catalogFunctions from "./abi-catalog/functions.json";
import catalogLabels from "./abi-catalog/labels.json";

type CatalogFunction = AbiFunction & { abi?: string };

// Kept from before the catalog: governance functions some ABIs above may not declare.
const BUILT_IN = parseAbi([
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

const canonical = (p: AbiParameter): string =>
  p.type.startsWith("tuple")
    ? `(${("components" in p ? p.components : []).map(canonical).join(",")})${p.type.slice(5)}`
    : p.type;

export const signatureOf = (fn: AbiFunction) => `${fn.name}(${fn.inputs.map(canonical).join(",")})`;

let bySelector: Map<Hex, CatalogFunction[]> | null = null;

/** Every known function by selector; a selector two signatures share keeps both. */
function catalog() {
  if (bySelector) return bySelector;
  const map = new Map<Hex, CatalogFunction[]>();
  const seen = new Set<string>();
  for (const fn of [...(catalogFunctions as unknown as CatalogFunction[]), ...BUILT_IN]) {
    const signature = signatureOf(fn);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const selector = toFunctionSelector(fn);
    map.set(selector, [...(map.get(selector) ?? []), fn]);
  }
  bySelector = map;
  return map;
}

export const knownFunctionCount = () => [...catalog().values()].reduce((n, l) => n + l.length, 0);

/** The known signatures with this 4-byte selector (a diamond cut's selectors, say). */
export const functionsWithSelector = (selector: string): string[] =>
  (catalog().get(selector.toLowerCase() as Hex) ?? []).map(signatureOf);

/** A decoded parameter. `chainId`: where its addresses live, when not on the call's own chain. */
export type ParamNode = {
  name: string;
  /** As declared: `address`, `uint256`, `tuple[]`, … */
  type: string;
  /** The struct, enum or contract name the ABI gives it (`Diamond.FacetCut`). */
  struct?: string;
  chainId?: number;
} & (
  | { kind: "value"; value: string }
  | { kind: "tuple"; children: ParamNode[] }
  | { kind: "array"; children: ParamNode[] }
  | {
      kind: "bytes";
      value: Hex;
      /** The bytes as calldata of a known function. */
      call: DecodedFunction | null;
      /** Or as a payload the calling function implies (`what` says which). */
      payload: (ParamNode & { what: string }) | null;
    }
);

export type DecodedFunction = {
  name: string;
  signature: string;
  selector: Hex;
  /** The ABI file the signature comes from. */
  abi?: string;
  args: ParamNode[];
  /** Other known signatures with this selector whose decoding also reproduces the bytes. */
  alternatives: string[];
  /** The address the call is made to, when a sibling parameter names it (`target`, `to`, …). */
  to?: Address;
  chainId?: number;
};

const MAX_DEPTH = 8;

// ZKsync Era's diamond on each L1, and the Era chain behind it.
// Exported (with ERA_CHAIN and L1_OF) for a single-file build of another ecosystem (standalone/ecosystems).
export const ERA_DIAMONDS: Record<string, { l1: number; l2: number }> = {
  "0x32400084c286cf3e17e7b677ea9583e60a000324": { l1: 1, l2: 324 },
  "0x9a6de0f62aa270a8bcb1e2610078650d539b1ef9": { l1: 11155111, l2: 300 },
};
export const ERA_CHAIN: Record<number, number> = { 1: 324, 11155111: 300 };
export const L1_OF: Record<number, number> = { 324: 1, 300: 11155111 };
const L1_CHAINS = new Set([1, 11155111, 17000, 31337]);

// Fields of an L1 → L2 request whose addresses and calldata are on the L2 the request names.
const L2_REQUEST_FIELDS: Record<string, RegExp> = {
  requestL2TransactionDirect: /^(l2Contract|l2Calldata|factoryDeps|refundRecipient)$/,
  requestL2TransactionTwoBridges: /^refundRecipient$/,
};

type Context = { fn: string; depth: number; chainId?: number; to?: string };

/**
 * `data` as a call to one of the known functions, or null. `to`: the address it is sent to (for
 * the Era diamond's requestL2Transaction); `chainId`: its chain when not the page's own.
 */
export function decodeFunction(
  data: Hex,
  { depth = 0, chainId, to }: { depth?: number; chainId?: number; to?: string } = {}
): DecodedFunction | null {
  if (depth > MAX_DEPTH || size(data) < 4) return null;
  const selector = slice(data, 0, 4);
  const matches: { fn: CatalogFunction; args: readonly unknown[] }[] = [];
  for (const fn of catalog().get(selector) ?? []) {
    try {
      const { args } = decodeFunctionData({ abi: [fn], data });
      const again = encodeFunctionData({
        abi: [fn],
        functionName: fn.name,
        args,
      } as Parameters<typeof encodeFunctionData>[0]);
      if (again.toLowerCase() === data.toLowerCase()) matches.push({ fn, args: args ?? [] });
    } catch {
      // Not this signature.
    }
  }
  const [match] = matches;
  if (!match) return null;
  const { fn, args } = match;
  const ctx: Context = { fn: fn.name, depth, chainId, to };
  const diamond = to ? ERA_DIAMONDS[to.toLowerCase()] : undefined;
  const nodes = fn.inputs.map((p, i) => {
    // The Era diamond's Mailbox: the request's L2 side is on Era.
    const l2 =
      fn.name === "requestL2Transaction" &&
      diamond &&
      /contractL2|calldata|factoryDeps|refundRecipient/i.test(p.name ?? "");
    return toNode(p, args[i], { ...ctx, chainId: l2 ? diamond.l2 : chainId }, p.name || `arg${i}`);
  });
  linkTargets(nodes);
  return {
    name: fn.name,
    signature: signatureOf(fn),
    selector,
    ...(fn.abi ? { abi: fn.abi } : {}),
    args: nodes,
    alternatives: matches.slice(1).map((m) => signatureOf(m.fn)),
    ...(chainId !== undefined ? { chainId } : {}),
  };
}

const structOf = (p: AbiParameter) =>
  /^(?:struct|enum|contract) ([A-Za-z0-9_.$]+)/.exec(p.internalType ?? "")?.[1];

function toNode(p: AbiParameter, raw: unknown, ctx: Context, name: string): ParamNode {
  const base = {
    name,
    type: p.type,
    ...(structOf(p) ? { struct: structOf(p) } : {}),
    ...(ctx.chainId !== undefined ? { chainId: ctx.chainId } : {}),
  };
  const array = /^(.*)\[(\d*)\]$/.exec(p.type);
  if (array) {
    const element = { ...p, type: array[1] ?? "" } as AbiParameter;
    const items = (raw as readonly unknown[]) ?? [];
    return {
      ...base,
      kind: "array",
      children: items.map((item, i) => toNode(element, item, ctx, `[${i}]`)),
    };
  }
  if (p.type === "tuple") {
    const components = "components" in p ? p.components : [];
    const fields = L2_REQUEST_FIELDS[ctx.fn];
    const value = raw as Record<string, unknown> | readonly unknown[];
    const field = (c: AbiParameter, i: number) =>
      Array.isArray(value) ? value[i] : (value as Record<string, unknown>)[c.name ?? ""];
    // An L1 → L2 request names its L2: those fields live there.
    const chainIdAt = components.findIndex((c) => c.name === "chainId");
    const chainIdField = components[chainIdAt];
    const l2 = fields && chainIdField ? Number(field(chainIdField, chainIdAt)) : Number.NaN;
    const children = components.map((c, i) =>
      toNode(
        c,
        field(c, i),
        fields?.test(c.name ?? "") && Number.isFinite(l2) ? { ...ctx, chainId: l2 } : ctx,
        c.name || `[${i}]`
      )
    );
    linkTargets(children);
    return { ...base, kind: "tuple", children };
  }
  if (p.type === "bytes") return bytesNode(base, raw as Hex, ctx);
  if (p.type === "address") return { ...base, kind: "value", value: getAddress(raw as string) };
  return { ...base, kind: "value", value: String(raw) };
}

// ProtocolUpgradeHandler.UpgradeProposal, as L1Messenger.sendToL1 carries it from Era to L1.
const PROPOSAL = {
  name: "proposal",
  type: "tuple",
  internalType: "struct ProtocolUpgradeHandler.UpgradeProposal",
  components: [
    {
      name: "calls",
      type: "tuple[]",
      internalType: "struct ProtocolUpgradeHandler.Call[]",
      components: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
    },
    { name: "executor", type: "address" },
    { name: "salt", type: "bytes32" },
  ],
} as const satisfies AbiParameter;

function bytesNode(
  base: Omit<ParamNode, "kind" | "value" | "children" | "call" | "payload">,
  value: Hex,
  ctx: Context
): ParamNode {
  let payload: (ParamNode & { what: string }) | null = null;
  let call: DecodedFunction | null = null;
  if (size(value) > 0) {
    if (ctx.fn === "sendToL1") {
      try {
        const [proposal] = decodeAbiParameters([PROPOSAL], value);
        if (encodeAbiParameters([PROPOSAL], [proposal]).toLowerCase() === value.toLowerCase()) {
          const l1 = ctx.chainId !== undefined ? L1_OF[ctx.chainId] : undefined;
          payload = {
            ...toNode(
              PROPOSAL,
              proposal,
              { fn: "UpgradeProposal", depth: ctx.depth + 1, chainId: l1 },
              "proposal"
            ),
            what: "UpgradeProposal",
          };
        }
      } catch {
        // Not a proposal.
      }
    }
    if (!payload)
      call = decodeFunction(value, { depth: ctx.depth + 1, chainId: base.chainId ?? ctx.chainId });
  }
  return { ...base, kind: "bytes", value, call, payload };
}

// A nested call is made to the address its sibling names.
const TARGET = /^_?(target|to|l2contract|contractl2)$/i;
const CALLDATA = /^_?(data|calldata|l2calldata)$/i;
function linkTargets(siblings: ParamNode[]) {
  const target = siblings.find(
    (s) => s.kind === "value" && s.type === "address" && TARGET.test(s.name)
  );
  if (!target || target.kind !== "value") return;
  for (const s of siblings)
    if (s.kind === "bytes" && s.call && CALLDATA.test(s.name)) s.call.to = target.value as Address;
}

// ---- labels and hints shown with the values ----

const SYSTEM_CONTRACTS: Record<string, string> = {
  "0x0000000000000000000000000000000000008002": "AccountCodeStorage",
  "0x0000000000000000000000000000000000008003": "NonceHolder",
  "0x0000000000000000000000000000000000008004": "KnownCodesStorage",
  "0x0000000000000000000000000000000000008005": "ImmutableSimulator",
  "0x0000000000000000000000000000000000008006": "ContractDeployer",
  "0x0000000000000000000000000000000000008007": "ForceDeployer",
  "0x0000000000000000000000000000000000008008": "L1Messenger",
  "0x0000000000000000000000000000000000008009": "MsgValueSimulator",
  "0x000000000000000000000000000000000000800a": "L2BaseToken",
  "0x000000000000000000000000000000000000800b": "SystemContext",
  "0x000000000000000000000000000000000000800c": "BootloaderUtilities",
  "0x000000000000000000000000000000000000800d": "EventWriter",
  "0x000000000000000000000000000000000000800e": "Compressor",
  "0x000000000000000000000000000000000000800f": "ComplexUpgrader",
  "0x0000000000000000000000000000000000010000": "Create2Factory",
  "0x0000000000000000000000000000000000010001": "L2GenesisUpgrade",
  "0x0000000000000000000000000000000000010002": "L2Bridgehub",
  "0x0000000000000000000000000000000000010003": "L2AssetRouter",
  "0x0000000000000000000000000000000000010004": "L2NativeTokenVault",
  "0x0000000000000000000000000000000000010005": "L2MessageRoot",
};

/** A known name for an address on a chain (imported labels, Era's diamond, system contracts). */
export function addressLabel(address: string, chainId: number | undefined): string | null {
  const a = address.toLowerCase();
  const byChain = (catalogLabels as Record<string, Record<string, string>>)[String(chainId)];
  if (byChain?.[a]) return byChain[a];
  const diamond = ERA_DIAMONDS[a];
  if (diamond && diamond.l1 === chainId) return "ZKsync Era diamond";
  // System contracts sit at the same addresses on every ZKsync chain, never on an L1.
  if (chainId !== undefined && !L1_CHAINS.has(chainId) && SYSTEM_CONTRACTS[a])
    return SYSTEM_CONTRACTS[a];
  return null;
}

const ENUMS: Record<string, string[]> = {
  "Diamond.Action": ["Add", "Replace", "Remove"],
  "Enum.Operation": ["Call", "DelegateCall"],
  PubdataPricingMode: ["Rollup", "Validium"],
};
const MAX_UINT256 = (1n << 256n) - 1n;

function duration(total: number) {
  const out: string[] = [];
  let seconds = total;
  for (const [unit, n] of [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ] as const) {
    if (seconds >= n && out.length < 2) {
      out.push(`${Math.floor(seconds / n)}${unit}`);
      seconds %= n;
    }
  }
  return out.join(" ") || "0s";
}

function units(v: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const fraction = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** What a number likely means, from its type and name: an enum value, a date, a duration, … */
export function numberHint(node: ParamNode): string | null {
  if (node.kind !== "value" || !/^u?int/.test(node.type)) return null;
  let v: bigint;
  try {
    v = BigInt(node.value);
  } catch {
    return null;
  }
  const name = node.name.toLowerCase();
  if (node.struct && /^uint8$/.test(node.type)) {
    const names = ENUMS[node.struct] ?? ENUMS[node.struct.split(".").pop() ?? ""];
    return names?.[Number(v)] ?? null;
  }
  if (v === MAX_UINT256) return "max uint256";
  if (
    /timestamp|deadline|until|expir|^_?time$/.test(name) &&
    v >= 1_000_000_000n &&
    v < 10_000_000_000n
  )
    return `${new Date(Number(v) * 1000)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, " UTC")}`;
  if (/protocolversion|semver/.test(name) && v > 0xffff_ffffn) {
    const major = v >> 64n;
    const minor = (v >> 32n) & 0xffff_ffffn;
    const patch = v & 0xffff_ffffn;
    if (major < 100n && minor < 1000n && patch < 1000n) return `v${major}.${minor}.${patch}`;
  }
  if (/delay|period|duration|timeout|cooldown/.test(name) && v > 0n && v < 100_000_000n)
    return duration(Number(v));
  if (/amount|value|mint|balance|fee/.test(name) && v >= 1_000_000_000_000n)
    return `${units(v, 18)} at 18 decimals`;
  return null;
}
