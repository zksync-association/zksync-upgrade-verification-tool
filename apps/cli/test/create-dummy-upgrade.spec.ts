import { describe, expect, it } from "vitest";
import { RpcClient } from "../src/ethereum/rpc-client";
import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { BlockExplorerClient } from "../src/ethereum/block-explorer-client";
import { Diamond } from "../src/reports/diamond";
import { createFakeUpgrade } from "./utilities/dummy-upgrade";
import { padHex } from "viem";
import process from "node:process";

describe("createDummyUpgrade", () => {
  it.skip("creates an upgrade that can be executed", async () => {
    const explorer = BlockExplorerClient.forL1(process.env.ETHERSCAN_API_KEY!, "mainnet")
    const rpc = new RpcClient(process.env.L1_RPC_URL!)
    const diamond = new Diamond(DIAMOND_ADDRS.mainnet)
    await diamond.init(explorer, rpc)
    const stateTransitionManager = await diamond.getTransitionManager(rpc, explorer)
    const transitionManager  = stateTransitionManager
    const callData = await createFakeUpgrade(stateTransitionManager, rpc, { verifier: padHex("0x01", { size: 20 }) });

    const response = await rpc.contractReadRaw(
      transitionManager.publicAddress(),
      callData,
      await stateTransitionManager.upgradeHandlerAddress(rpc)
    )

    expect(response).toEqual("0x")
  })
})