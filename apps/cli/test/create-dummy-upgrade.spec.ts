import { describe, expect, it } from "vitest";
import { RpcClient } from "../src/ethereum/rpc-client";
import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { BlockExplorerClient } from "../src/ethereum/block-explorer-client";
import { Diamond } from "../src/reports/diamond";
import { createFakeUpgrade } from "./utilities/dummy-upgrade";
import { type Address, type Hex, padHex } from "viem";
import process from "node:process";

describe("createDummyUpgrade", () => {
  it.skip("creates an upgrade that can be executed", async () => {
    const etherscanapikey = process.env.ETHERSCAN_API_KEY;
    const url = process.env.L1_RPC_URL;
    if (!etherscanapikey || !url) {
      throw new Error("Missing env vars");
    }

    const explorer = BlockExplorerClient.forL1(etherscanapikey, "mainnet");
    const rpc = new RpcClient(url);
    const diamond = new Diamond(DIAMOND_ADDRS.mainnet);
    await diamond.init(explorer, rpc);
    const stateTransitionManager = await diamond.getTransitionManager(rpc, explorer);
    const transitionManager = stateTransitionManager;
    const callData = await createFakeUpgrade(diamond, explorer, rpc, {
      verifier: padHex("0x01", { size: 20 }),
      systemContracts: [],
    });

    const response = await rpc.contractReadRaw(
      transitionManager.publicAddress(),
      callData,
      await stateTransitionManager.upgradeHandlerAddress(rpc)
    );

    expect(response).toEqual("0x");
  });

  it.skip("creates an upgrade that can be executed with some system contracts", async () => {
    const etherscanapikey = process.env.ETHERSCAN_API_KEY;
    const url = process.env.L1_RPC_URL;
    if (!etherscanapikey || !url) {
      throw new Error("Missing env vars");
    }

    const explorer = BlockExplorerClient.forL1(etherscanapikey, "mainnet");
    const rpc = new RpcClient(url);
    const diamond = new Diamond(DIAMOND_ADDRS.mainnet);
    await diamond.init(explorer, rpc);
    const stateTransitionManager = await diamond.getTransitionManager(rpc, explorer);
    const transitionManager = stateTransitionManager;
    const systemContracts = [
      {
        address: "0x0000000000000000000000000000000000008010" as Address,
        hash: "0x0100000f248e111a1b587fef850dc4585c39af2dd505bc8a0d5cc6d3fcc7ed30" as Hex,
      },
      {
        address: "0x0000000000000000000000000000000000008012" as Address,
        hash: "0x01000023b02bbb21baf1367835e56ae17b82688527dc8f78caf34b12e670ee60" as Hex,
      },
    ];
    const callData = await createFakeUpgrade(diamond, explorer, rpc, {
      verifier: padHex("0x01", { size: 20 }),
      systemContracts: systemContracts,
      newVersion: 204089315107n,
    });

    const from = await stateTransitionManager.upgradeHandlerAddress(rpc);
    const response = await rpc.contractReadRaw(transitionManager.publicAddress(), callData, from);

    expect(response).toEqual("0x");
  });

  it.skip("can create an upgrade that changes diamond shards", async () => {
    const etherscanapikey = process.env.ETHERSCAN_API_KEY;
    const url = process.env.L1_RPC_URL;
    if (!etherscanapikey || !url) {
      throw new Error("Missing env vars");
    }

    const explorer = BlockExplorerClient.forL1(etherscanapikey, "mainnet");
    const rpc = new RpcClient(url);
    const diamond = new Diamond(DIAMOND_ADDRS.mainnet);
    await diamond.init(explorer, rpc);
    const callData = await createFakeUpgrade(diamond, explorer, rpc, {
      verifier: padHex("0x01", { size: 20 }),
      systemContracts: [],
      newFacets: [
        {
          facet: "0x230214F0224C7E0485f348a79512ad00514DB1F7",
          selectors: [
            "0x0e18b681",
            "0xe58bb639",
            "0x64bf8d66",
            "0xa9f6d941",
            "0x27ae4c16",
            "0x4dd18bf5",
            "0xf235757f",
            "0x1cc5d103",
            "0xbe6f11cf",
            "0x4623c91d",
            "0x17338945",
          ],
        },
        {
          facet: "0x10113bB3a8e64f8eD67003126adC8CE74C34610c",
          selectors: [
            "0xcdffacc6",
            "0x52ef6b2c",
            "0xadfca15e",
            "0x7a0ed627",
            "0x79823c9a",
            "0x4fc07d75",
            "0xd86970d8",
            "0xfd791f3c",
            "0xe5355c75",
            "0x9d1b5a81",
            "0x7b30c8da",
            "0x8665b150",
            "0x631f4bac",
            "0x0ec6b0b7",
            "0x33ce93fe",
            "0xdb1f0bf9",
            "0xb8c2f66f",
            "0xef3f0bae",
            "0xfe26699e",
            "0x39607382",
            "0xaf6a2dcd",
            "0xa1954fc5",
            "0x46657fe9",
            "0x18e3a941",
            "0x29b98c67",
            "0xbd7c5412",
            "0xc3bbd2d7",
            "0xe81e0ba1",
            "0xfacd743b",
            "0x9cd939e4",
            "0x56142d7a",
            "0xb22dd78e",
            "0x74f4d30d",
          ],
        },
        {
          facet: "0xA57F9FFD65fC0F5792B5e958dF42399a114EC7e7",
          selectors: [
            "0x6c0960f9",
            "0xb473318e",
            "0x042901c7",
            "0x263b7f8e",
            "0xe4948f43",
            "0xeb672419",
          ],
        },
        {
          facet: "0xfd3779e6214eBBd40f5F5890351298e123A46BA6",
          selectors: ["0x701f58c5", "0xc3d93e7c", "0x7f61885c", "0x97c09d34"],
        },
      ],
    });

    const transitionManager = await diamond.getTransitionManager(rpc, explorer);

    const response = await rpc.contractReadRaw(
      transitionManager.publicAddress(),
      callData,
      await transitionManager.upgradeHandlerAddress(rpc)
    );

    expect(response).toEqual("0x");
  });
});
