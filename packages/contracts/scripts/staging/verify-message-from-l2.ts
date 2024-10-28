import { getZkWallet } from "../util/with-protocol-governor.js";
import { Contract } from "zksync-ethers";
import "dotenv/config";

const abi = [
  {
    name: "proveL2MessageInclusion",
    inputs: [
      {
        name: "_batchNumber",
        type: "uint256",
      },
      {
        name: "_index",
        type: "uint256",
      },
      {
        name: "_message",
        type: "tuple",
        components: [
          {
            name: "txNumberInBatch",
            type: "uint16",
          },
          {
            name: "sender",
            type: "address",
          },
          {
            name: "data",
            type: "bytes",
          },
        ],
      },
      {
        name: "_proof",
        type: "bytes32[]",
      },
    ],
  },
] as const;

async function main() {
  const contract = new Contract("0x6d6e010a2680e2e5a3b097ce411528b36d880ef6", abi, getZkWallet());

  // const txid = "0xa5ecf0a2700a2a5cb7e645f14f847525abc6815754a32b53ca4f3e63a217a372"

  const tx = await contract
    .getFunction("proveL2MessageInclusion")
    .staticCall(616251n, 0n, 1n, [
        "0x72abee45b59e344af8a6e520241c4744aff26ed411f4c4b00f8af09adada43ba",
        "0xc3d03eebfd83049991ea3d3e358b6712e7aa2e2e63dc2d4b438987cec28ac8d0",
        "0xe3697c7f33c31a9b0f0aeb8542287d0d21e8c4cf82163d0c44c7a98aa11aa111",
        "0x199cc5812543ddceeddd0fc82807646a4899444240db2c0d2f20c3cceb5f51fa",
        "0xe4733f281f18ba3ea8775dd62d2fcd84011c8c938f16ea5790fd29a03bf8db89",
        "0x1798a1fd9c8fbb818c98cff190daa7cc10b6e5ac9716b4a2649f7c2ebcef2272",
        "0x66d7c5983afe44cf15ea8cf565b34c6c31ff0cb4dd744524f7842b942d08770d",
        "0xb04e5ee349086985f74b73971ce9dfe76bbed95c84906c5dffd96504e1e5396c",
        "0xac506ecb5465659b3a927143f6d724f91d8d9c4bdb2463aee111d9aa869874db",
        "0x124b05ec272cecd7538fdafe53b6628d31188ffb6f345139aac3c3c1fd2e470f",
        "0xc3be9cbd19304d84cca3d045e06b8db3acd68c304fc9cd4cbffe6d18036cb13f",
        "0xfef7bd9f889811e59e4076a0174087135f080177302763019adaf531257e3a87",
        "0xa707d1c62d8be699d34cb74804fdd7b4c568b6c1a821066f126c680d4b83e00b",
        "0xf6e093070e0389d2e529d60fadb855fdded54976ec50ac709e3a36ceaa64c291",
      ],
      {
        calls: [
          {
            target: "0x0000000000000000000000000000000000000000",
            value: "0",
            data: "0x"
          },
          {
            target: "0x0000000000000000000000000000000000000000",
            value: "0",
            data: "0x"
          }
        ],
        executor: "0x0000000000000000000000000000000000000000",
        salt: "0x0000000000000000000000000000000000000000000000000000000000000000"
      }
    );

  console.log(tx);
}

await main();
