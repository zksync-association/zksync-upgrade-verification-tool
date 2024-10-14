import { describe, expect, it } from "vitest";
import { RpcClient } from "../src/ethereum/rpc-client";
import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { BlockExplorerClient } from "../src/ethereum/block-explorer-client";
import { Diamond } from "../src/reports/diamond";
import { createFakeUpgrade } from "./utilities/dummy-upgrade";
import { type Address, type Hex, padHex } from "viem";
import process from "node:process";

describe("createDummyUpgrade", () => {
  it("creates an upgrade that can be executed", async () => {
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
    const callData = await createFakeUpgrade(stateTransitionManager, rpc, {
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

  it("creates an upgrade that can be executed with some system contracts", async () => {
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
        hash: "0x0100000f248e111a1b587fef850dc4585c39af2dd505bc8a0d5cc6d3fcc7ed3b" as Hex,
      },
      {
        address: "0x0000000000000000000000000000000000008012" as Address,
        hash: "0x01000023b02bbb21baf1367835e56ae17b82688527dc8f78caf34b12e670ee64" as Hex,
      },
    ];
    const callData = await createFakeUpgrade(stateTransitionManager, rpc, {
      verifier: padHex("0x01", { size: 20 }),
      systemContracts: systemContracts,
      newVersion: 204089315107n,
    });

    console.log(callData);

    const response = await rpc.contractReadRaw(
      transitionManager.publicAddress(),
      callData,
      await stateTransitionManager.upgradeHandlerAddress(rpc)
    );

    expect(response).toEqual("0x");
  });
});
