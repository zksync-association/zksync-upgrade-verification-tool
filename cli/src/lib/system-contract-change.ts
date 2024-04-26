import type { Hex } from "viem";
import { ContractData } from "./zk-sync-era-state";
import type { BlockExplorerClient } from "./block-explorer-client";
import type { GithubClient } from "./github-client";

export class SystemContractChange {
  address: Hex;
  name: string;
  currentBytecodeHash: Hex;
  proposedBytecodeHash: Hex;

  constructor(address: Hex, name: string, currentBytecodeHash: Hex, proposedBytecodeHash: Hex) {
    this.address = address;
    this.name = name;
    this.currentBytecodeHash = currentBytecodeHash;
    this.proposedBytecodeHash = proposedBytecodeHash;
  }

  async downloadCurrentCode(github: GithubClient): Promise<ContractData> {
    const source = await github.downloadContract(this.name);

    return new ContractData(this.name, source, this.address);
  }

  async downloadProposedCode(client: BlockExplorerClient): Promise<ContractData> {
    return client.getSourceCode(this.address);
  }
}
