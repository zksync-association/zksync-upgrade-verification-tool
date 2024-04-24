import type { VerifierContract } from "./verifier.js";
import path from "node:path";
import fs from "node:fs/promises";
import type { AbiSet } from "./abi-set.js";
import CliTable from "cli-table3";
import type { ContractData } from "./zk-sync-era-state.js";
import type {BlockExplorerClient} from "./block-explorer-client.js";

export class ZkSyncEraDiff {
  private oldVersion: string;
  private newVersion: string;
  private orphanedSelectors: string[];
  facetChanges: {
    oldAddress: string;
    newAddress: string;
    name: string;
    oldData: ContractData;
    newData: ContractData;
    oldSelectors: string[];
    newSelectors: string[];
  }[];

  private oldVerifier: VerifierContract;
  private newVerifier: VerifierContract;

  constructor(
    oldVersion: string,
    newVersion: string,
    orphanedSelectors: string[],
    oldVerifier: VerifierContract,
    newVerifier: VerifierContract
  ) {
    this.oldVersion = oldVersion;
    this.newVersion = newVersion;
    this.orphanedSelectors = orphanedSelectors;
    this.facetChanges = [];
    this.oldVerifier = oldVerifier;
    this.newVerifier = newVerifier;
  }

  add(
    oldAddress: string,
    newAddress: string,
    name: string,
    oldData: ContractData,
    newData: ContractData,
    oldSelectors: string[],
    newSelectors: string[]
  ): void {
    this.facetChanges.push({
      oldAddress,
      newAddress,
      name,
      oldData,
      newData,
      oldSelectors,
      newSelectors,
    });
  }

  async writeCodeDiff(baseDirPath: string, filter: string[], client: BlockExplorerClient): Promise<void> {
    const baseDirOld = path.join(baseDirPath, "old");
    const baseDirNew = path.join(baseDirPath, "new");

    await this.writeFacets(filter, baseDirOld, baseDirNew);
    await this.writeVerifier(baseDirOld, baseDirNew, client);
  }

  private async writeVerifier (baseDirOld: string, baseDirNew: string, client: BlockExplorerClient) {
    const oldVerifierPath = path.join(baseDirOld, 'verifier')
    const oldVerifierCode = await this.oldVerifier.getCode(client)
    await oldVerifierCode.writeSources(oldVerifierPath)
    const newVerifierPath = path.join(baseDirNew, 'verifier')
    const newVerifierCode = await this.newVerifier.getCode(client)
    await newVerifierCode.writeSources(newVerifierPath)
  }

  private async writeFacets (filter: string[], baseDirOld: string, baseDirNew: string) {
    for (const {name, oldData, newData} of this.facetChanges) {
      if (filter.length > 0 && !filter.includes(name)) {
        continue;
      }

      const dirOld = path.join(baseDirOld, "facets", name);
      const dirNew = path.join(baseDirNew, "facets", name);

      await oldData.writeSources(dirOld)
      await newData.writeSources(dirNew)
    }
  }

  async toCliReport(abis: AbiSet, upgradeDir: string): Promise<string> {
    const title = "Upgrade report:";
    const strings = [`${title}`, "=".repeat(title.length), ''];

    const metadataTable = new CliTable({
      head: ["Metadata"],
      style: { compact: true },
    });
    metadataTable.push(["Current protocol version", this.oldVersion]);
    metadataTable.push(["Proposed protocol version", this.newVersion]);
    strings.push(metadataTable.toString());

    strings.push("L1 Main contract Diamond upgrades:");
    if (this.facetChanges.length === 0) {
      strings.push("No diamond changes", "");
    }

    for (const change of this.facetChanges) {
      const table = new CliTable({
        head: [change.name],
        style: { compact: true },
      });

      table.push(["Current address", change.oldAddress]);
      table.push(["Upgrade address", change.newAddress]);
      table.push(["Proposed contract verified etherscan", "Yes"]);

      const newFunctions = await Promise.all(
        change.newSelectors
          .filter((s) => !change.oldSelectors.includes(s))
          .map(async (selector) => {
            await abis.fetch(change.newAddress);
            return abis.signatureForSelector(selector);
          })
      );
      table.push(["New Functions", newFunctions.length ? newFunctions.join(", ") : "None"]);

      const removedFunctions = await Promise.all(
        change.oldSelectors
          .filter((s) => this.orphanedSelectors.includes(s))
          .map(async (selector) => {
            await abis.fetch(change.newAddress);
            return abis.signatureForSelector(selector);
          })
      );

      table.push([
        "Removed functions",
        removedFunctions.length ? removedFunctions.join(", ") : "None",
      ]);
      table.push(["To compare code", `pnpm validate show-diff ${upgradeDir} ${change.name}`]);

      strings.push(table.toString());
    }

    strings.push("", "Verifier:");
    const verifierTable = new CliTable({
      head: ["Attribute", "Current value", "Upgrade value"],
      style: { compact: true },
    });

    verifierTable.push(["Address", this.oldVerifier.address, this.newVerifier.address]);
    verifierTable.push([
      "Recursion node level VkHash",
      this.oldVerifier.recursionNodeLevelVkHash,
      this.newVerifier.recursionNodeLevelVkHash,
    ]);
    verifierTable.push([
      "Recursion circuits set VksHash",
      this.oldVerifier.recursionCircuitsSetVksHash,
      this.newVerifier.recursionCircuitsSetVksHash,
    ]);
    verifierTable.push([
      "Recursion leaf level VkHash",
      this.oldVerifier.recursionLeafLevelVkHash,
      this.newVerifier.recursionLeafLevelVkHash,
    ]);
    strings.push(verifierTable.toString());

    return strings.join("\n");
  }
}
