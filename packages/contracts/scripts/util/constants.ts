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
  callDatas: [
    calldata,
  ],
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
export const PROTOCOL_GOV_TIME_CONTROLLER_ADDR = "0xd29db7d43077eab1d1c6b2aa1cfa160d669ed7cf";
export const PROVE_L2_INCLUSION_ABI = [
  {
    inputs: [
      {internalType: "uint256", name: "_batchNumber", type: "uint256"},
      {internalType: "uint256", name: "_index", type: "uint256"},
      {
        components: [
          {internalType: "uint16", name: "txNumberInBatch", type: "uint16"},
          {internalType: "address", name: "sender", type: "address"},
          {internalType: "bytes", name: "data", type: "bytes"}
        ],
        internalType: "struct L2Message", name: "_message", type: "tuple"
      },
      {internalType: "bytes32[]", name: "_proof", type: "bytes32[]"}
    ],
    name: "proveL2MessageInclusion",
    outputs: [{internalType: "bool", name: "", type: "bool"}],
    stateMutability: "view",
    type: "function"
  }
] as const;

export const STAGING_DIAMOND_ADDRESS = "0x6d6e010a2680e2e5a3b097ce411528b36d880ef6";