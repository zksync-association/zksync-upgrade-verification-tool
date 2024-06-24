import type { Hex } from "viem";
import type { L2ContractData } from "./current-zksync-era-state";
import { InconsistentData } from "./errors";
import type { RpcClient } from "./rpc-client";
import type { BlockExplorerClient } from "./block-explorer-client";
import { utils } from "zksync-ethers";

export interface SystemContractProvider {
  dataFor(addr: Hex): Promise<L2ContractData>;
}

export class SystemContractList implements SystemContractProvider {
  private data: Map<string, L2ContractData>;

  constructor(data: L2ContractData[]) {
    this.data = new Map();
    data.map((contract) => {
      this.data.set(contract.address.toLowerCase(), contract);
    });
  }

  async dataFor(addr: Hex): Promise<L2ContractData> {
    const find = this.data.get(addr.toLowerCase());
    if (!find) {
      throw new InconsistentData(`Missing system contract data for "${addr}".`);
    }
    return find;
  }
}

export class RpcSystemContractProvider implements SystemContractProvider {
  private rpc: RpcClient;
  private explorer: BlockExplorerClient;

  constructor(rpc: RpcClient, explorer: BlockExplorerClient) {
    this.rpc = rpc;
    this.explorer = explorer;
  }

  async dataFor(addr: Hex): Promise<L2ContractData> {
    const byteCode = await this.rpc.getByteCode(addr);

    if (!byteCode) {
      throw new Error("no bytecode");
    }

    const hex = Buffer.from(utils.hashBytecode(byteCode)).toString("hex");

    const data = await this.explorer.getSourceCode(addr);

    return {
      name: data.name,
      bytecodeHash: `0x${hex}`,
      address: addr,
    };
  }
}
