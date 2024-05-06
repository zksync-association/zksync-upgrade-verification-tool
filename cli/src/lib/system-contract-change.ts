import type { Hex } from "viem";
import type { BlockExplorerClient } from "./block-explorer-client";
import type { GithubClient } from "./github-client";
import { ContractData } from "./contract-data.js";
import { ContracNotVerified } from "./errors.js";

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
    try {
      return await client.getSourceCode(this.address);
    } catch (e) {
      // Some system contracts do not have the code available in the block explorer. But this is not an error.
      // For these contracts we cannot show the current source code.
      if (e instanceof ContracNotVerified) {
        const content = {
          content: `Code for contract ${this.address} (${this.name}) is not available in block explorer`,
        };
        return new ContractData(this.name, { "messate.txt": content }, this.address);
      }
      throw e;
    }
  }

  async downloadProposedCode(github: GithubClient): Promise<ContractData> {
    const source = await github.downloadContract(this.name);

    return new ContractData(this.name, source, this.address);
  }
}
