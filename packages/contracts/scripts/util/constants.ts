import { encodeFunctionData, type Hex, zeroAddress } from "viem";

export const PROTOCOL_GOVERNOR_ADDRESS = "0x08c18e8359C3c6aA600A3726BA6dCC100e222021";
export const GOVOPS_GOVERNOR_ADDRESS = "0xd39E2B556EB66b27e5532e629098022D3976e93B";
export const TOKEN_GOVERNOR_ADDRESS = "0xE85eBc0a4245031669E7BC1d5F77EB17d5B50387";
export const ZK_TOKEN_ADDRESS = "0xfcd338217Fec145A3c8Dba9645cc2DaBD616B8E7";



const calldata = encodeFunctionData({
  abi: [
    {
      inputs: [
        {
          internalType: "bytes",
          name: "_message",
          type: "bytes",
        },
      ],
      name: "sendToL1",
      outputs: [
        {
          internalType: "bytes32",
          name: "hash",
          type: "bytes32",
        },
      ],
      stateMutability: "nonpayable",
      type: "function",
    },
  ],
  functionName: "sendToL1",
  args: [
    "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000358baca94dcd7931b7ba7aaf8a5ac6090e143a500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000004499a88ec400000000000000000000000035a54c8c757806eb6820629bc82d90e056394c92000000000000000000000000cb4c8d1ecdca0e256a7341c4487938cfaaed432200000000000000000000000000000000000000000000000000000000",
  ],
});

export type UpgradeData = {
  addresses: Hex[];
  values: bigint[];
  callDatas: Hex[];
  description: string;
};

export const EXAMPLE_PROTOCOL_UPGRADE: UpgradeData = {
  addresses: ["0x0000000000000000000000000000000000008008"],
  values: [0n],
  callDatas: [calldata],
  description: "Test protocol proposal 02",
};

export const EXAMPLE_GOVOPS_PROPOSAL: UpgradeData = {
  addresses: [zeroAddress],
  values: [0n],
  callDatas: ["0x"],
  description: "Test govops proposal 02",
};

export const EXAMPLE_TOKEN_PROPOSAL: UpgradeData = {
  addresses: [zeroAddress],
  values: [0n],
  callDatas: ["0x"],
  description: "Test token proposal 04",
};

export const ALL_PROPOSAL_STATES = [
  "Pending",
  "Active",
  "Canceled",
  "Defeated",
  "Succeeded",
  "Queued",
  "Expired",
  "Executed",
];
