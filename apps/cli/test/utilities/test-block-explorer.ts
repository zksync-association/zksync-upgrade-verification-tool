import type { BlockExplorer } from "../../src/etherscan/block-explorer-client";
import type { ContractAbi } from "../../src/etherscan/contract-abi";
import type { ContractData } from "../../src/etherscan/contract-data";

export class TestBlockExplorer implements BlockExplorer {
  abis: Map<string, ContractAbi>;

  constructor() {
    this.abis = new Map();
  }

  async getAbi(rawAddress: string): Promise<ContractAbi> {
    const abi = this.abis.get(rawAddress);
    if (!abi) {
      throw Error("");
    }
    return abi;
  }

  getSourceCode(_rawAddress: string): Promise<ContractData> {
    throw new Error("not implemented");
  }

  isVerified(_addr: string): Promise<boolean> {
    throw new Error("not implemented");
  }

  registerAbi(abi: ContractAbi, address: string) {
    this.abis.set(address, abi);
  }
}
