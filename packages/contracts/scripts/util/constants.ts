import { encodeAbiParameters, encodeFunctionData, type Hex, zeroAddress } from "viem";

export const PROTOCOL_GOVERNOR_ADDRESS = "0x08c18e8359C3c6aA600A3726BA6dCC100e222021";
export const GOVOPS_GOVERNOR_ADDRESS = "0xd39E2B556EB66b27e5532e629098022D3976e93B";
export const TOKEN_GOVERNOR_ADDRESS = "0xE85eBc0a4245031669E7BC1d5F77EB17d5B50387";
export const ZK_TOKEN_ADDRESS = "0xfcd338217Fec145A3c8Dba9645cc2DaBD616B8E7";

export const upgradeStructAbi = {
  type: "tuple",
  components: [
    {
      type: "tuple[]",
      components: [
        { type: "address", name: "target" },
        { type: "uint256", name: "value" },
        { type: "bytes", name: "data" },
      ],
      name: "calls",
    },
    { type: "address", name: "executor" },
    { type: "bytes32", name: "salt" },
  ],
} as const;


export const nullUpgradeCalldata = encodeAbiParameters(
  [upgradeStructAbi],
  [
    {
      calls: [
        {
          data: "0x",
          target: zeroAddress,
          value: 0n,
        },
      ],
      executor: zeroAddress,
      salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
    },
  ]
);

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
  args: [nullUpgradeCalldata],
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
  callDatas: ["0x62f84b24000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000"],
  description: "Test protocol proposal 06",
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
