// A whole fake L1 node behind fakeJsonRpc, for tests that run the app's real modules end to end
// (rpc.ts lanes and viem client, governance(), the log index, upgrade status reads): mainnet's
// chain id and pinned ProtocolUpgradeHandler, its governance contracts with small member lists,
// member Safes, upgradeState/upgradeStatus per id, Multicall3's aggregate3, the head and the
// 'finalized' tag, and eth_getLogs over the handler's logs. Every eth_call is recorded, decoded.
// Nothing here touches the network.

import {
  ERC1271_MAGIC_VALUE,
  emergencyUpgradeBoardAbi,
  guardiansAbi,
  safeAbi,
  securityCouncilAbi,
  upgradeHandlerAbi,
} from "@/common/abis";
import { safeMessageHashes } from "@/common/safe";
import {
  type Abi,
  type Address,
  type Hex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  getAddress,
  keccak256,
  multicall3Abi,
  pad,
  parseAbi,
  parseAbiParameters,
  zeroHash,
} from "viem";
import { type ChainLog, blockHash, fakeChain } from "./fake-chain";
import { type FakeCall, type FakeOptions, FakeRpcError, fakeJsonRpc } from "./fake-jsonrpc";

export const L1 = {
  upgradeHandler: getAddress("0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3"),
  deployBlock: 21_788_382n,
  securityCouncil: getAddress("0x59195219d1176E42f8e607e9AC114926D47f9035"),
  guardians: getAddress("0x600dA620Ab29F41ABC6596a15981e14cE58c86b8"),
  emergencyUpgradeBoard: getAddress("0xF73a7dCfa68E52030ec39E41a23DCA51F3aAa111"),
  zkFoundation: getAddress("0xbC1653bd3829dfEc575AfC3816D4899cd103B51c"),
  multicall3: getAddress("0xcA11bde05977b3631167028862bE2a173976CA11"),
} as const;

const member = (group: number, i: number) =>
  getAddress(`0x${group.toString(16)}${(i + 1).toString(16).padStart(39, "0")}`);
export const SC_MEMBERS = [0, 1, 2].map((i) => member(0xa, i));
export const G_MEMBERS = [0, 1, 2].map((i) => member(0xb, i));

/** Every address's code on the fake node unless FakeL1Options.code says otherwise. */
export const FAKE_CODE: Hex = "0x6080604052";
/** The Safe singleton and fallback handler the fake node's Safes report (Safe 1.3.0's, as on mainnet). */
export const FAKE_SAFE_SINGLETON = getAddress("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552");
export const FAKE_SAFE_HANDLER = getAddress("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4");

/**
 * Code pins (common/networks.ts CodePins) that the fake node's contracts match: with these in
 * place (chain/pins.ts overrideCodePinsForTests) the app relies on them as on mainnet.
 */
export const FAKE_PINS = {
  securityCouncil: keccak256(FAKE_CODE),
  guardians: keccak256(FAKE_CODE),
  emergencyUpgradeBoard: keccak256(FAKE_CODE),
  safeProxy: keccak256(FAKE_CODE),
  safeSingleton: FAKE_SAFE_SINGLETON,
  safeFallbackHandler: FAKE_SAFE_HANDLER,
} as const;

export type UpgradeOnChain = {
  state: number;
  /** creationTimestamp, securityCouncilApprovalTimestamp, guardiansApproval, guardiansExtendedLegalVeto, executed */
  status: readonly [number, number, boolean, boolean, boolean];
};

/** One decoded eth_call the node answered (directly or inside an aggregate3). */
export type L1Call = {
  to: Address;
  functionName: string;
  args: readonly unknown[];
  /** "latest" or the block number as hex. */
  block: string;
  viaMulticall: boolean;
};

export type FakeL1Options = {
  head: { number: bigint; hash?: Hex; timestamp?: bigint };
  finalized?: bigint | null;
  logs?: ChainLog[];
  /** upgradeState/upgradeStatus per id (lower case). Others: None, zeros. */
  upgrades?: Map<string, UpgradeOnChain>;
  clientVersion?: string;
  /** Answers a call instead of the contract (e.g. a FakeRpcError); undefined: the contract answers. */
  inject?: (call: L1Call) => FakeRpcError | undefined;
  /**
   * The contract's value for a call instead of the table's (REVERTS: it reverts, as a member list
   * past its end does); undefined: the table answers.
   */
  answer?: (call: L1Call) => unknown;
  /** Contracts at other addresses that behave as these (new address → existing contract). */
  aliases?: Map<Address, Address>;
  /** Awaited before answering a call (to hold a read in flight). */
  gate?: (call: L1Call) => Promise<void> | undefined;
  /**
   * The node's answer to every eth_call at `block` ("latest" or a hex number) instead of running
   * it, e.g. an error for state it no longer keeps; undefined: the call runs.
   */
  stateAt?: (block: string) => FakeRpcError | undefined;
  delayMs?: FakeOptions["delayMs"];
  /**
   * Member signatures the Security Council and Guardians accept in checkSignatures (and in
   * isValidSignature's abi.encode(signers, signatures)), and signatures a Safe accepts in its own
   * isValidSignature, as `${signer}:${signature}` (`${safe}:${signature}`) in lower case (any
   * threshold); every other set reverts.
   */
  signatures?: Set<string>;
  /**
   * How the node answers Multicall3's getBlockNumber()/getLastBlockHash() in an eth_call at a
   * block: in that block's context ("block", the default: the block's number and its parent's
   * hash) or the next block's ("next-block": number + 1 and the block's own hash). A function
   * answers for one call's block tag instead (undefined: the convention).
   */
  guard?: "block" | "next-block";
  guardAt?: (block: string) => { number: bigint; lastHash: Hex } | undefined;
  /**
   * The node's answer to an aggregate3 at `block` as a whole instead of running it (e.g. out of
   * gas, an internal error); undefined: it runs. Direct calls are not affected.
   */
  aggregateError?: (block: string) => FakeRpcError | undefined;
  /** An address's code at a block tag ("latest" or hex; undefined: FAKE_CODE), or an error. */
  code?: (address: Address, block: string) => Hex | FakeRpcError | undefined;
  /**
   * The node's answer to eth_getTransactionReceipt: a receipt (fakeReceipt), null (not mined), or
   * an error. Without it the node does not know the method.
   */
  receipt?: (hash: Hex) => Record<string, unknown> | null | FakeRpcError;
};

/** A mined transaction's receipt as a node sends it (eth_getTransactionReceipt). */
export function fakeReceipt(hash: Hex, block: bigint, status: "success" | "reverted" = "success") {
  const hex = (n: bigint) => `0x${n.toString(16)}`;
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: blockHash(block),
    blockNumber: hex(block),
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x3b9aca00",
    contractAddress: null,
    logs: [],
    logsBloom: `0x${"00".repeat(256)}`,
    status: status === "success" ? "0x1" : "0x0",
    type: "0x2",
  };
}

/** FakeL1Options.answer's way to answer a call with these exact bytes (e.g. "0x"). */
export class RawAnswer {
  constructor(readonly data: Hex) {}
}

const errorAbi = parseAbi(["error Panic(uint256)"]);
// What the fake node's Safes answer (Safe 1.3.0's own getters besides the app's ABI), and
// Multicall3's block getters.
const fakeSafeAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function domainSeparator() view returns (bytes32)",
  "function signedMessages(bytes32) view returns (uint256)",
  "function getMessageHash(bytes message) view returns (bytes32)",
  "function isValidSignature(bytes32 _dataHash, bytes _signature) view returns (bytes4)",
  "function masterCopy() view returns (address)",
  "function getStorageAt(uint256 offset, uint256 length) view returns (bytes)",
]);
const multicallViewAbi = parseAbi([
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getLastBlockHash() view returns (bytes32 blockHash)",
]);
void safeAbi;
const outOfBounds = encodeErrorResult({ abi: errorAbi, errorName: "Panic", args: [0x32n] });
const REVERT = Symbol("revert");
/** FakeL1Options.answer's way to make a call revert (Panic 0x32, as members(i) past the end). */
export const REVERTS = REVERT;

function abiOf(to: Address, aliases?: Map<Address, Address>): Abi {
  const address = getAddress(to);
  switch (aliases?.get(address) ?? address) {
    case L1.upgradeHandler:
      return upgradeHandlerAbi as Abi;
    case L1.securityCouncil:
      return securityCouncilAbi as Abi;
    case L1.guardians:
      return guardiansAbi as Abi;
    case L1.emergencyUpgradeBoard:
      return emergencyUpgradeBoardAbi as Abi;
    case L1.multicall3:
      return multicallViewAbi as Abi;
    default:
      return fakeSafeAbi as Abi;
  }
}

export function fakeL1(options: FakeL1Options) {
  const chain = fakeChain({
    address: L1.upgradeHandler,
    logs: options.logs ?? [],
    head: options.head,
    finalized: options.finalized,
  });
  const upgrades = options.upgrades ?? new Map<string, UpgradeOnChain>();
  const calls: L1Call[] = [];
  /** Block of every aggregate3 the node answered. */
  const multicalls: string[] = [];
  /** Every aggregate3 the node answered: its block and the functions it called. */
  const aggregates: { block: string; functions: string[] }[] = [];

  function value(call: L1Call): unknown {
    const to = options.aliases?.get(getAddress(call.to)) ?? getAddress(call.to);
    const domain = (name: string) => ["0x0f", name, "1", 1n, getAddress(call.to), zeroHash, []];
    const id = String(call.args[0] ?? "").toLowerCase();
    // Multisig.checkSignatures(digest, signers, signatures, threshold): returns nothing.
    const checkSignatures = () => {
      const [, signers, signatures] = call.args as [Hex, Address[], Hex[]];
      return signers.every((signer, i) =>
        options.signatures?.has(`${signer}:${signatures[i]}`.toLowerCase())
      )
        ? undefined
        : REVERT;
    };
    // Multisig.isValidSignature(digest, abi.encode(signers, signatures)).
    const multisigIsValid = () => {
      const [, encoded] = call.args as [Hex, Hex];
      const [signers, signatures] = decodeAbiParameters(
        parseAbiParameters("address[], bytes[]"),
        encoded
      );
      return signers.length > 0 &&
        signers.every((signer, i) =>
          options.signatures?.has(`${signer}:${signatures[i]}`.toLowerCase())
        )
        ? ERC1271_MAGIC_VALUE
        : REVERT;
    };
    // Multicall3's block getters, as the node runs an eth_call at that block (see guard).
    const guardAt = () => {
      const custom = options.guardAt?.(call.block);
      if (custom) return custom;
      const head = chain.options.head ?? { number: 0n };
      const n = call.block === "latest" ? head.number : BigInt(call.block);
      const hashOf = (k: bigint) => (head.hash && k === head.number ? head.hash : blockHash(k));
      return options.guard === "next-block"
        ? { number: n + 1n, lastHash: hashOf(n) }
        : { number: n, lastHash: blockHash(n - 1n) };
    };
    const tables: Record<string, Record<string, () => unknown>> = {
      [L1.upgradeHandler]: {
        securityCouncil: () => L1.securityCouncil,
        guardians: () => L1.guardians,
        emergencyUpgradeBoard: () => L1.emergencyUpgradeBoard,
        protocolFrozenUntil: () => 0n,
        lastFreezeStatusInUpgradeCycle: () => 0,
        upgradeState: () => upgrades.get(id)?.state ?? 0,
        upgradeStatus: () => [...(upgrades.get(id)?.status ?? [0, 0, false, false, false])],
      },
      [L1.securityCouncil]: {
        EIP1271_THRESHOLD: () => 2n,
        APPROVE_UPGRADE_SECURITY_COUNCIL_THRESHOLD: () => 2n,
        softFreezeThreshold: () => 1n,
        SOFT_FREEZE_CONSERVATIVE_THRESHOLD: () => 2n,
        HARD_FREEZE_THRESHOLD: () => 2n,
        UNFREEZE_THRESHOLD: () => 2n,
        softFreezeNonce: () => 0n,
        hardFreezeNonce: () => 0n,
        unfreezeNonce: () => 0n,
        softFreezeThresholdSettingNonce: () => 0n,
        PROTOCOL_UPGRADE_HANDLER: () => L1.upgradeHandler,
        eip712Domain: () => domain("SecurityCouncil"),
        members: () => SC_MEMBERS[Number(call.args[0])] ?? REVERT,
        checkSignatures,
        isValidSignature: multisigIsValid,
      },
      [L1.guardians]: {
        EIP1271_THRESHOLD: () => 2n,
        APPROVE_UPGRADE_GUARDIANS_THRESHOLD: () => 2n,
        EXTEND_LEGAL_VETO_THRESHOLD: () => 1n,
        CANCEL_L2_GOVERNOR_PROPOSAL_THRESHOLD: () => 2n,
        nonce: () => 0n,
        PROTOCOL_UPGRADE_HANDLER: () => L1.upgradeHandler,
        eip712Domain: () => domain("Guardians"),
        members: () => G_MEMBERS[Number(call.args[0])] ?? REVERT,
        checkSignatures,
        isValidSignature: multisigIsValid,
      },
      [L1.emergencyUpgradeBoard]: {
        ZK_FOUNDATION_SAFE: () => L1.zkFoundation,
        SECURITY_COUNCIL: () => L1.securityCouncil,
        GUARDIANS: () => L1.guardians,
        PROTOCOL_UPGRADE_HANDLER: () => L1.upgradeHandler,
        eip712Domain: () => domain("EmergencyUpgradeBoard"),
      },
      [L1.multicall3]: {
        getBlockNumber: () => guardAt().number,
        getLastBlockHash: () => guardAt().lastHash,
      },
    };
    const safe: Record<string, () => unknown> = {
      VERSION: () => "1.4.1",
      getThreshold: () => 2n,
      getOwners: () => [member(0xc, 0), member(0xc, 1)],
      domainSeparator: () => safeMessageHashes(1, getAddress(call.to), zeroHash).domainHash,
      // No message approved on-chain (SignMessageLib).
      signedMessages: () => 0n,
      isValidSignature: () => {
        const [, signature] = call.args as [Hex, Hex];
        return options.signatures?.has(`${getAddress(call.to)}:${signature}`.toLowerCase())
          ? ERC1271_MAGIC_VALUE
          : REVERT;
      },
      masterCopy: () => FAKE_SAFE_SINGLETON,
      getStorageAt: () => pad(FAKE_SAFE_HANDLER.toLowerCase() as Hex, { size: 32 }),
    };
    const overridden = options.answer?.(call);
    if (overridden !== undefined) return overridden;
    const answer = (tables[to] ?? safe)[call.functionName];
    if (!answer) throw new Error(`fake L1: unexpected ${to}.${call.functionName}`);
    return answer();
  }

  /** The contract's answer: return data, or a revert / injected error. */
  async function evaluate(
    to: Address,
    data: Hex,
    block: string,
    viaMulticall: boolean
  ): Promise<{ data: Hex } | { error: FakeRpcError }> {
    const abi = abiOf(to, options.aliases);
    const decoded = decodeFunctionData({ abi, data }) as {
      functionName: string;
      args?: readonly unknown[];
    };
    const call: L1Call = {
      to: getAddress(to),
      functionName: decoded.functionName,
      args: decoded.args ?? [],
      block,
      viaMulticall,
    };
    calls.push(call);
    await options.gate?.(call);
    const injected = options.inject?.(call);
    if (injected) return { error: injected };
    const result = value(call);
    if (result === REVERT) return { error: new FakeRpcError(3, "execution reverted", outOfBounds) };
    if (result instanceof RawAnswer) return { data: result.data };
    // viem takes a single output's value wrapped in an array (else an array value would be
    // read as the list of outputs).
    const item = abi.find(
      (entry) => entry.type === "function" && entry.name === decoded.functionName
    ) as { outputs: readonly unknown[] };
    return {
      data: encodeFunctionResult({
        abi,
        functionName: decoded.functionName,
        result: item.outputs.length === 1 ? [result] : result,
      } as never),
    };
  }

  async function handle(call: FakeCall): Promise<unknown> {
    switch (call.method) {
      case "eth_chainId":
        return "0x1";
      case "web3_clientVersion":
        return options.clientVersion ?? "Geth/v1.15.0-fake";
      case "eth_getCode": {
        const [address, block] = call.params as [Address, string];
        return options.code?.(getAddress(address), block) ?? FAKE_CODE;
      }
      case "eth_call": {
        const [tx, block] = call.params as [{ to: Address; data: Hex }, string];
        const refused = options.stateAt?.(block);
        if (refused) return refused;
        if (getAddress(tx.to) !== L1.multicall3) {
          const answer = await evaluate(tx.to, tx.data, block, false);
          return "error" in answer ? answer.error : answer.data;
        }
        multicalls.push(block);
        const whole = options.aggregateError?.(block);
        if (whole) return whole;
        const { args } = decodeFunctionData({ abi: multicall3Abi, data: tx.data });
        const subcalls = (args?.[0] ?? []) as readonly { target: Address; callData: Hex }[];
        const aggregate = { block, functions: [] as string[] };
        aggregates.push(aggregate);
        const results = await Promise.all(
          subcalls.map(async ({ target, callData }) => {
            aggregate.functions.push(
              (
                decodeFunctionData({ abi: abiOf(target, options.aliases), data: callData }) as {
                  functionName: string;
                }
              ).functionName
            );
            const answer = await evaluate(target, callData, block, true);
            // Inside aggregate3 a failure is only (false, revert data).
            if ("error" in answer)
              return {
                success: false,
                returnData: (typeof answer.error.data === "string"
                  ? answer.error.data
                  : "0x") as Hex,
              };
            return { success: true, returnData: answer.data };
          })
        );
        return encodeFunctionResult({
          abi: multicall3Abi,
          functionName: "aggregate3",
          result: [results] as never,
        });
      }
      case "eth_getTransactionReceipt":
        if (!options.receipt) return chain.handle(call);
        return options.receipt((call.params as [Hex])[0]);
      case "anvil_nodeInfo":
      case "hardhat_metadata":
        return new FakeRpcError(-32601, "method not found");
      default:
        return chain.handle(call);
    }
  }

  const upstream = fakeJsonRpc({ handle, delayMs: options.delayMs });
  return {
    ...upstream,
    chain,
    upgrades,
    calls,
    multicalls,
    aggregates,
    /** The aggregate3 calls at `block` that read upgrade states (the sync engine's status step). */
    stateAggregates: (block: string) =>
      aggregates.filter((a) => a.block === block && a.functions.includes("upgradeState")),
    /** JSON-RPC requests of one method, across every POST. */
    requests: (method: string) =>
      upstream.posts.flatMap((post) => post.calls.filter((c) => c.method === method)),
  };
}
