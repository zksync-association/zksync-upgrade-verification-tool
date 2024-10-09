import { describe, it } from "vitest";
import { RpcClient } from "../src/ethereum/rpc-client";
import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { BlockExplorerClient } from "../src/ethereum/block-explorer-client";
import { Diamond } from "../src/reports/diamond";
import { createFakeUpgrade } from "./utilities/dummy-upgrade";
import { padHex } from "viem";

describe("createDummyUpgrade", () => {
  it("works", async () => {
    const explorer = BlockExplorerClient.forL1("88S18B5T9MQPPDCVMWHZC87FXTZ3BREAUI", "mainnet")
    const rpc = new RpcClient("https://mainnet.gateway.tenderly.co/1ooZXz5grkFD15LMjKrVC0")
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
    console.log(response)
  })
})