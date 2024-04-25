import type {Hex} from "viem";
import {ContractData} from "./zk-sync-era-state";
import {downloadContract} from "./github-download";
import type {Octokit} from "@octokit/core";
import type {BlockExplorerClient} from "./block-explorer-client";

export class SystemContractChange {
  address: Hex
  name: string
  currentBytecodeHash: Hex
  proposedBytecodeHash: Hex

  constructor(
    address: Hex,
    name: string,
    currentBytecodeHash: Hex,
    proposedBytecodeHash: Hex
  ) {
    this.address = address
    this.name = name
    this.currentBytecodeHash = currentBytecodeHash
    this.proposedBytecodeHash = proposedBytecodeHash
  }

  async downloadCurrentCode(octo: Octokit): Promise<ContractData> {
    const source = await downloadContract(octo, `system-contracts/contracts/${this.name}.sol`, {})

    return new ContractData(
      this.name,
      source,
      this.address
    )
  }

  async downloadProposedCode(client: BlockExplorerClient): Promise<ContractData> {
    return client.getSourceCode(this.address)
  }
}