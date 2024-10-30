import { type Address, type Hex, hexToBigInt, slice } from "viem";
import type { ContractAbi } from "../ethereum/contract-abi";
import type { RpcClient } from "../ethereum/rpc-client";
import type { BlockExplorer } from "../ethereum/block-explorer-client";
import { addressSchema } from "@repo/common/schemas";
import { z } from "zod";

function bytes32ToAddress(bytes: Hex): Hex {
  return slice(bytes, 12, 32);
}

const PROXY_IMPLEMENTATION_STORAGE_POS =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export class StateTransitionManager {
  private address: Address;
  private abi: ContractAbi;

  constructor(address: Address, abi: ContractAbi) {
    this.address = address;
    this.abi = abi;
  }

  static async create(
    proxyAddress: Address,
    rpc: RpcClient,
    explorer: BlockExplorer
  ): Promise<StateTransitionManager> {
    const managerAddress = bytes32ToAddress(
      await rpc.storageRead(proxyAddress, hexToBigInt(PROXY_IMPLEMENTATION_STORAGE_POS))
    );
    const managerAbi = await explorer.getAbi(managerAddress);

    return new StateTransitionManager(proxyAddress, managerAbi);
  }

  async upgradeHandlerAddress(rpc: RpcClient): Promise<Address> {
    return rpc.contractRead(this.address, "owner", this.abi.raw, addressSchema);
  }

  async allHyperchainIds(rpc: RpcClient): Promise<bigint[]> {
    return rpc.contractRead(
      this.address,
      "getAllHyperchainChainIDs",
      this.abi.raw,
      z.array(z.bigint())
    );
  }

  publicAddress() {
    return this.address;
  }
}
