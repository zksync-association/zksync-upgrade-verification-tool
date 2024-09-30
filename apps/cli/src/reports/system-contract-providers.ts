import type { Hex } from "viem";
import type { L2ContractData } from "./zksync-era-state.js";
import { utils } from "zksync-ethers";
import { Option } from "nochoices";
import type { BlockExplorerClient } from "../etherscan/block-explorer-client";
import type { RpcClient } from "../etherscan/rpc-client";
import type { ContractData } from "../etherscan/contract-data";

export interface SystemContractProvider {
  dataFor(addr: Hex): Promise<Option<L2ContractData>>;
}

export class SystemContractList implements SystemContractProvider {
  private data: Map<string, L2ContractData>;

  constructor(data: L2ContractData[]) {
    this.data = new Map();
    data.map((contract) => {
      this.data.set(contract.address.toLowerCase(), contract);
    });
  }

  async dataFor(addr: Hex): Promise<Option<L2ContractData>> {
    const find = this.data.get(addr.toLowerCase());
    return Option.fromNullable(find);
  }
}

export class RpcSystemContractProvider implements SystemContractProvider {
  private rpc: RpcClient;
  private explorer: BlockExplorerClient;

  constructor(rpc: RpcClient, explorer: BlockExplorerClient) {
    this.rpc = rpc;
    this.explorer = explorer;
  }

  async dataFor(addr: Hex): Promise<Option<L2ContractData>> {
    const byteCode = await this.rpc.getByteCode(addr);

    if (!byteCode) {
      throw new Error("no bytecode");
    }

    const hex = Buffer.from(utils.hashBytecode(byteCode)).toString("hex");

    const data = await this.explorer.getSourceCode(addr).then(
      (data) => Option.Some(data),
      () => Option.None<ContractData>()
    );

    return data.map((d) => {
      return {
        name: d.name.replace(/^.*:/, ""),
        bytecodeHash: `0x${hex}`,
        address: addr,
      };
    });
  }
}
