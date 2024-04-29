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

  async downloadCurrentCode(client: BlockExplorerClient): Promise<ContractData> {
    return client.getSourceCode(this.address);
  }

  async downloadProposedCode(github: GithubClient, ref: string): Promise<ContractData> {
    const source = await github.downloadContract(this.name, ref);

    return new ContractData(this.name, source, this.address);
  }
}
