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
  changes: {
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
    this.changes = [];
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
    this.changes.push({
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

    const oldVerifierCode = await this.oldVerifier.getCode(client)
    const newVerifierCode = await this.newVerifier.getCode(client)
  }

  private async writeFacets (filter: string[], baseDirOld: string, baseDirNew: string) {
    for (const {name, oldData, newData} of this.changes) {
      if (filter.length > 0 && !filter.includes(name)) {
        continue;
      }

      const dirOld = path.join(baseDirOld, "facets", name);
      const dirNew = path.join(baseDirNew, "facets", name);

      for (const fileName in oldData.sources.sources) {
        const {content} = oldData.sources.sources[fileName];
        path.parse(fileName).dir;
        const filePath = path.join(dirOld, fileName);
        await fs.mkdir(path.parse(filePath).dir, {recursive: true});
        await fs.writeFile(filePath, content);
      }

      for (const fileName in newData.sources.sources) {
        const {content} = newData.sources.sources[fileName];
        const filePath = path.join(dirNew, fileName);
        await fs.mkdir(path.parse(filePath).dir, {recursive: true});
        await fs.writeFile(filePath, content);
      }
    }
  }

  async toCliReport(abis: AbiSet, upgradeDir: string): Promise<string> {
    const title = "Upgrade report:";
    const strings = [`${title} \n`, "=".repeat(title.length)];

    const metadataTable = new CliTable({
      head: ["Metadata"],
      style: { compact: true },
    });
    metadataTable.push(["Current protocol version", this.oldVersion]);
    metadataTable.push(["Proposed protocol version", this.newVersion]);
    strings.push(metadataTable.toString());

    strings.push("L1 Main contract Diamond upgrades:");
    if (this.changes.length === 0) {
      strings.push("No diamond changes", "");
    }

    for (const change of this.changes) {
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
