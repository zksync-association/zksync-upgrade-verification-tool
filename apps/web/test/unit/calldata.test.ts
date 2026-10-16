import {
  type ParamNode,
  addressLabel,
  decodeFunction,
  functionsWithSelector,
  knownFunctionCount,
  numberHint,
} from "@/common/calldata";
import {
  type Hex,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
} from "viem";
import { describe, expect, it } from "vitest";

const abi = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function upgrade(address proxy, address implementation)",
  "struct L2TransactionRequestDirect { uint256 chainId; uint256 mintValue; address l2Contract; uint256 l2Value; bytes l2Calldata; uint256 l2GasLimit; uint256 l2GasPerPubdataByteLimit; bytes[] factoryDeps; address refundRecipient; }",
  "function requestL2TransactionDirect(L2TransactionRequestDirect _request)",
  "function sendToL1(bytes _message)",
]);
const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;
const find = (nodes: ParamNode[], name: string) => {
  const node = nodes.find((n) => n.name === name);
  if (!node) throw new Error(`no ${name}`);
  return node;
};

describe("decodeFunction", () => {
  it("knows the imported ABIs' functions, not only the hand-written ones", () => {
    expect(knownFunctionCount()).toBeGreaterThan(700);
    const d = decodeFunction(encodeFunctionData({ abi, functionName: "approve", args: [A, 5n] }));
    expect(d).toMatchObject({
      name: "approve",
      signature: "approve(address,uint256)",
      alternatives: [],
    });
    expect(d?.args.map((a) => [a.name, a.kind === "value" ? a.value : null])).toEqual([
      ["spender", A],
      ["amount", "5"],
    ]);
  });

  it("decodes only what encodes back to the exact bytes", () => {
    const data = encodeFunctionData({ abi, functionName: "upgrade", args: [A, B] });
    expect(decodeFunction(data)?.name).toBe("upgrade");
    expect(decodeFunction(concat([data, "0x00"]))).toBeNull();
    expect(decodeFunction("0xdeadbeef")).toBeNull();
  });

  it("opens an L1 → L2 request: its calldata as a call, its L2 fields on the L2 it names", () => {
    const inner = encodeFunctionData({ abi, functionName: "upgrade", args: [A, B] });
    const data = encodeFunctionData({
      abi,
      functionName: "requestL2TransactionDirect",
      args: [
        {
          chainId: 324n,
          mintValue: 0n,
          l2Contract: B,
          l2Value: 0n,
          l2Calldata: inner,
          l2GasLimit: 72_000_000n,
          l2GasPerPubdataByteLimit: 800n,
          factoryDeps: [],
          refundRecipient: A,
        },
      ],
    });
    const d = decodeFunction(data, { chainId: 1 });
    const request = d?.args[0];
    if (request?.kind !== "tuple") throw new Error("no request");
    expect(request.struct).toBe("L2TransactionRequestDirect");
    expect(find(request.children, "chainId").chainId).toBe(1);
    expect(find(request.children, "l2Contract").chainId).toBe(324);
    const calldata = find(request.children, "l2Calldata");
    if (calldata.kind !== "bytes") throw new Error("no calldata");
    // The nested call, made to the request's l2Contract, on the L2.
    expect(calldata.call).toMatchObject({ name: "upgrade", to: B, chainId: 324 });
  });

  it("names the function a selector stands for", () => {
    expect(functionsWithSelector("0x095ea7b3")).toEqual(["approve(address,uint256)"]);
    expect(functionsWithSelector("0x12345678")).toEqual([]);
  });

  it("leaves bytes that are not a known call raw", () => {
    const data = encodeFunctionData({ abi, functionName: "sendToL1", args: ["0x1234"] });
    const message = decodeFunction(data)?.args[0];
    expect(message).toMatchObject({ kind: "bytes", value: "0x1234", call: null, payload: null });
  });

  it("reads Era's sendToL1 message as the upgrade proposal it carries to L1", () => {
    const proposal = {
      calls: [{ target: A, value: 0n, data: "0x" as Hex }],
      executor: zeroAddress,
      salt: `0x${"00".repeat(32)}` as Hex,
    };
    const message = encodeAbiParameters(
      parseAbi([
        "struct Call { address target; uint256 value; bytes data; }",
        "struct UpgradeProposal { Call[] calls; address executor; bytes32 salt; }",
        "function f(UpgradeProposal p)",
      ])[0].inputs,
      [proposal]
    );
    const d = decodeFunction(
      encodeFunctionData({ abi, functionName: "sendToL1", args: [message] }),
      {
        chainId: 324,
      }
    );
    const node = d?.args[0];
    if (node?.kind !== "bytes" || !node.payload) throw new Error("no payload");
    expect(node.payload.what).toBe("UpgradeProposal");
    // Its addresses are on L1.
    expect(node.payload.chainId).toBe(1);
  });
});

describe("labels and hints", () => {
  it("names known addresses on their chain", () => {
    expect(addressLabel("0x303a465B659cBB0ab36eE643eA362c509EEb5213", 1)).toBe("Bridgehub");
    expect(addressLabel("0x303a465B659cBB0ab36eE643eA362c509EEb5213", 11155111)).toBeNull();
    expect(addressLabel("0x32400084C286CF3E17e7B677ea9583e60a000324", 1)).toBe(
      "ZKsync Era diamond"
    );
    expect(addressLabel("0x000000000000000000000000000000000000800f", 324)).toBe("ComplexUpgrader");
    expect(addressLabel("0x000000000000000000000000000000000000800f", 1)).toBeNull();
    // On any ZKsync chain, the Gateway too.
    expect(addressLabel("0x0000000000000000000000000000000000010002", 9075)).toBe("L2Bridgehub");
  });

  it("says what a number likely is, from its type and name", () => {
    const n = (name: string, value: string, type = "uint256", struct?: string): ParamNode => ({
      kind: "value",
      name,
      type,
      value,
      ...(struct ? { struct } : {}),
    });
    expect(numberHint(n("action", "1", "uint8", "Diamond.Action"))).toBe("Replace");
    expect(numberHint(n("amount", ((1n << 256n) - 1n).toString()))).toBe("max uint256");
    expect(numberHint(n("deadline", "1760000000"))).toBe("2025-10-09 08:53:20 UTC");
    expect(numberHint(n("upgradeDelay", "86400"))).toBe("1d");
    expect(numberHint(n("_newProtocolVersion", ((29n << 32n) | 2n).toString()))).toBe("v0.29.2");
    expect(numberHint(n("mintValue", "570000000000000000000"))).toBe("570 at 18 decimals");
    expect(numberHint(n("amount", "5"))).toBeNull();
  });
});
