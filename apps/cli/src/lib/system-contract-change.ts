import type { Hex } from "viem";
import type { BlockExplorer } from "./block-explorer-client.js";
import { ContractData } from "./contract-data.js";
import { ContractNotVerified } from "./errors.js";
import type { GitContractsRepo } from "./git-contracts-repo.js";
import type { Option } from "nochoices";

export class SystemContractChange {
  address: Hex;
  name: string;
  currentBytecodeHash: Option<Hex>;
  proposedBytecodeHash: Hex;

  constructor(
    address: Hex,
    name: string,
    currentBytecodeHash: Option<Hex>,
    proposedBytecodeHash: Hex
  ) {
    this.address = address;
    this.name = name;
    this.currentBytecodeHash = currentBytecodeHash;
    this.proposedBytecodeHash = proposedBytecodeHash;
  }

  async downloadCurrentCode(client: BlockExplorer): Promise<ContractData> {
    try {
      const data = await client.getSourceCode(this.address);
      data.remapKeys("contracts-preprocessed", "");
      return data;
    } catch (e) {
      // Some system contracts do not have the code available in the block explorer. But this is not an error.
      // For these contracts we cannot show the current source code.
      if (e instanceof ContractNotVerified) {
        const content = {
          content: `Code for contract ${this.address} (${this.name}) is not available in block explorer`,
        };
        return new ContractData(this.name, { "message.txt": content }, this.address);
      }
      throw e;
    }
  }

  async downloadProposedCode(repo: GitContractsRepo): Promise<ContractData> {
    const source = await repo.downloadSystemContract(this.name);
    const data = new ContractData(this.name, source, this.address);
    data.remapKeys("system-contracts/contracts-preprocessed", "");
    return data;
  }
}
