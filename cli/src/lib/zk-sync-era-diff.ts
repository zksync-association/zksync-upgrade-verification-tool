import type { VerifierContract } from "./verifier.js";
import path from "node:path";
import CliTable from "cli-table3";
import type { BlockExplorerClient } from "./block-explorer-client.js";
import type { SystemContractChange } from "./system-contract-change";
import type { GithubClient } from "./github-client";
import { systemContractHashesSchema } from "../schema/github-schemas.js";
import { ContractData } from "./contract-data.js";
import { ADDRESS_ZERO, ZERO_U256 } from "./constants.js";
import chalk from "chalk";
import type {AbiSet} from "./abi-set.js";
import * as console from "node:console";

export class ZkSyncEraDiff {
  private oldVersion: string;
  private newVersion: string;
  private orphanedSelectors: string[];
  facetChanges: {
    oldAddress: string;
    newAddress: string;
    oldData: ContractData;
    newData?: ContractData;
    oldSelectors: string[];
    newSelectors: string[];
  }[];

  private systemContractChanges: SystemContractChange[];

  private oldVerifier: VerifierContract;
  private newVerifier: VerifierContract;
  private oldAA: string;
  private newAA: string;
  private oldBootLoader: string;
  private newBootLoader: string;
  private warnings: string[];

  constructor(
    oldVersion: string,
    newVersion: string,
    orphanedSelectors: string[],
    oldVerifier: VerifierContract,
    newVerifier: VerifierContract,
    oldAA: string,
    newAA: string,
    oldBootLoader: string,
    newBootLoader: string
  ) {
    this.oldVersion = oldVersion;
    this.newVersion = newVersion;
    this.orphanedSelectors = orphanedSelectors;
    this.facetChanges = [];
    this.systemContractChanges = [];
    this.oldVerifier = oldVerifier;
    this.newVerifier = newVerifier;
    this.oldAA = oldAA;
    this.newAA = newAA;
    this.oldBootLoader = oldBootLoader;
    this.newBootLoader = newBootLoader;
    this.warnings = []
  }

  addFacetVerifiedFacet (
    oldAddress: string,
    newAddress: string,
    oldData: ContractData,
    newData: ContractData | undefined,
    oldSelectors: string[],
    newSelectors: string[]
  ): void {
    this.facetChanges.push({
      oldAddress,
      newAddress,
      oldData,
      newData,
      oldSelectors,
      newSelectors,
    });
    this.facetChanges.sort((f1, f2) => f1.oldData.name.localeCompare(f2.oldData.name));
  }

  addFacetUnverifiedFacet (
    oldAddress: string,
    newAddress: string,
    oldData: ContractData,
    oldSelectors: string[],
    newSelectors: string[]
  ): void {
    this.facetChanges.push({
      oldAddress,
      newAddress,
      oldData,
      oldSelectors,
      newSelectors,
    });
    this.warnings.push(`L1 Contract not verified in therscan: ${newAddress}`)
    this.facetChanges.sort((f1, f2) => f1.oldData.name.localeCompare(f2.oldData.name));
  }


  addSystemContract(change: SystemContractChange) {
    this.systemContractChanges.push(change);
  }

  async writeCodeDiff(
    baseDirPath: string,
    filter: string[],
    l1Client: BlockExplorerClient,
    l2Client: BlockExplorerClient,
    github: GithubClient,
    ref: string
  ): Promise<void> {
    const baseDirOld = path.join(baseDirPath, "old");
    const baseDirNew = path.join(baseDirPath, "new");

    await this.writeFacets(filter, baseDirOld, baseDirNew);
    await this.writeVerifier(filter, baseDirOld, baseDirNew, l1Client);
    await this.writeSystemContracts(filter, baseDirOld, baseDirNew, l2Client, github, ref);
    await this.writeSpecialContracts(filter, baseDirNew, github, ref);
  }

  private async writeSpecialContracts(
    filter: string[],
    dir: string,
    github: GithubClient,
    ref: string
  ) {
    if (filter.length !== 0) {
      return;
    }

    const baseDirAA = path.join(dir, "defaultAA");
    const baseDirBL = path.join(dir, "bootloader");

    const rawHashes = await github.downloadFile("system-contracts/SystemContractsHashes.json", ref);
    const hashes = systemContractHashesSchema.parse(JSON.parse(rawHashes));

    if (this.newAA !== ZERO_U256) {
      const defaultAccountHash = hashes.find((h) => h.contractName === "DefaultAccount");
      if (!defaultAccountHash || defaultAccountHash.bytecodeHash !== this.newAA) {
        throw new Error(`Default Account contract byte code hash does not match in ref: ${ref}`);
      }

      const sourcesAA = await github.downloadContract("DefaultAccount", ref);
      const contractAA = new ContractData("DefaultAA", sourcesAA, ADDRESS_ZERO);
      await contractAA.writeSources(baseDirAA);
    }

    if (this.newBootLoader !== ZERO_U256) {
      const bootLoaderHash = hashes.find((h) => h.contractName === "proved_batch");
      if (!bootLoaderHash || bootLoaderHash.bytecodeHash !== this.newBootLoader) {
        throw new Error(`Bootloader contract byte code hash does not match in ref: ${ref}`);
      }

      const sourcesBL = await github.downloadFile(
        "system-contracts/bootloader/bootloader.yul",
        ref
      );
      const contractBL = new ContractData(
        "Bootloader",
        { "bootloader.yul": { content: sourcesBL } },
        ADDRESS_ZERO
      );
      await contractBL.writeSources(baseDirBL);
    }
  }

  private async writeVerifier(
    filter: string[],
    baseDirOld: string,
    baseDirNew: string,
    client: BlockExplorerClient
  ) {
    if (filter.length === 0 || filter.includes("verifier")) {
      const oldVerifierPath = path.join(baseDirOld, "verifier");
      const oldVerifierCode = await this.oldVerifier.getCode(client);
      await oldVerifierCode.writeSources(oldVerifierPath);
      const newVerifierPath = path.join(baseDirNew, "verifier");
      const newVerifierCode = await this.newVerifier.getCode(client);
      await newVerifierCode.writeSources(newVerifierPath);
    }
  }

  private async writeFacets(filter: string[], baseDirOld: string, baseDirNew: string) {
    for (const { oldData, newData, newAddress } of this.facetChanges) {
      if (!newData) {
        throw new Error(`Cannot show diff for ${oldData.name} facet. The new contract (${newAddress}) is not verified in etherscan`)
      }

      const name = oldData.name
      if (filter.length > 0 && !filter.includes(`facet:${name}`)) {
        continue;
      }

      const dirOld = path.join(baseDirOld, "facets", name);
      const dirNew = path.join(baseDirNew, "facets", name);

      await oldData.writeSources(dirOld);
      await newData.writeSources(dirNew);
    }
  }

  async toCliReport(
    abis: AbiSet,
    upgradeDir: string,
    github: GithubClient,
    ref: string
  ): Promise<string> {
    const title = "Upgrade report:";
    const strings = [`${title}`, "=".repeat(title.length), ""];

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
        head: [change.oldData.name],
        style: { compact: true },
      });

      table.push(["Current address", change.oldAddress]);
      table.push(["Upgrade address", change.newAddress]);
      table.push(["Proposed contract verified etherscan", change.newData ? 'Yes' : chalk.red('NO!')]);


      let newFunctions = change.newSelectors
        .filter((s) => !change.oldSelectors.includes(s))

      if (change.newData) {
        newFunctions = await Promise.all(
          newFunctions
            .map(async (selector) => {
              console.log(change.newAddress)
              await abis.fetch(change.newAddress);
              // return abis.signatureForSelector(selector);
              return selector
            })
        );
      }
      table.push(["New functions", newFunctions.length ? newFunctions.join(", ") : "None"]);

      const removedFunctions = await Promise.all(
        change.oldSelectors
          .filter((s) => this.orphanedSelectors.includes(s))
          .map(async (selector) => {
            await abis.fetch(change.oldAddress);
            return abis.signatureForSelector(selector);
          })
      );

      table.push([
        "Removed functions",
        removedFunctions.length ? removedFunctions.join(", ") : "None",
      ]);
      table.push(["To compare code", `pnpm validate facet-diff ${upgradeDir} ${change.oldData.name}`]);

      strings.push(table.toString());
    }

    strings.push("", "Verifier:");
    const verifierTable = new CliTable({
      head: ["Attribute", "Current value", "Upgrade value"],
      style: { compact: true },
    });

    const newVerifierAddr =
      this.oldVerifier.address === this.newVerifier.address ||
      this.newVerifier.address === ADDRESS_ZERO
        ? "No changes"
        : this.newVerifier.address;
    verifierTable.push(["Address", this.oldVerifier.address, newVerifierAddr]);

    const newNodeHash =
      this.oldVerifier.recursionNodeLevelVkHash === this.newVerifier.recursionNodeLevelVkHash
        ? "No changes"
        : this.newVerifier.recursionNodeLevelVkHash;
    verifierTable.push([
      "Recursion node level VkHash",
      this.oldVerifier.recursionNodeLevelVkHash,
      newNodeHash,
    ]);

    const newCircuitsHash =
      this.oldVerifier.recursionCircuitsSetVksHash === this.newVerifier.recursionCircuitsSetVksHash
        ? "No changes"
        : this.newVerifier.recursionCircuitsSetVksHash;
    verifierTable.push([
      "Recursion circuits set VksHash",
      this.oldVerifier.recursionCircuitsSetVksHash,
      newCircuitsHash,
    ]);

    const newLeafHash =
      this.oldVerifier.recursionLeafLevelVkHash === this.newVerifier.recursionLeafLevelVkHash
        ? "No changes"
        : this.newVerifier.recursionNodeLevelVkHash;
    verifierTable.push([
      "Recursion leaf level VkHash",
      this.oldVerifier.recursionLeafLevelVkHash,
      newLeafHash,
    ]);
    verifierTable.push([
      {
        content: "",
        colSpan: 3,
      },
    ]);
    verifierTable.push([
      "Show contract diff",
      {
        content: `pnpm validate verifier-diff ${upgradeDir}`,
        colSpan: 2,
      },
    ]);
    strings.push(verifierTable.toString(), "");

    strings.push("System contracts:");

    if (this.systemContractChanges.length > 0) {
      const sysContractTable = new CliTable({
        head: ["Name", "Address", "bytecode hashes"],
        // style: { compact: true },
      });

      for (const change of this.systemContractChanges) {
        sysContractTable.push(
          [
            { content: change.name, rowSpan: 2, vAlign: "center" },
            { content: change.address, rowSpan: 2, vAlign: "center" },
            `Current: ${change.currentBytecodeHash}`,
          ],
          [`Proposed: ${change.proposedBytecodeHash}`]
        );
      }
      strings.push(sysContractTable.toString());
    } else {
      strings.push("No changes in system contracts");
    }

    strings.push("", "Other contracts:");
    const otherContractsTable = new CliTable({
      head: [
        "Name",
        "Current Bytecode hash",
        "Proposed Bytecode Hash",
        "BytecodeHash matches with github",
      ],
      style: { compact: true },
    });

    const rawHashes = await github.downloadFile("system-contracts/SystemContractsHashes.json", ref);
    const hashes = systemContractHashesSchema.parse(JSON.parse(rawHashes));

    const defaultAccountHash = hashes.find((h) => h.contractName === "DefaultAccount");
    const bootLoaderHash = hashes.find((h) => h.contractName === "proved_batch");

    if (!defaultAccountHash) {
      throw new Error(`Missing default account hash for ref: ${ref}`);
    }
    if (!bootLoaderHash) {
      throw new Error(`Missing bootloader hash for ref: ${ref}`);
    }

    const newAAMsg = this.newAA === ZERO_U256 ? "No changes" : this.newAA;

    const aaBytecodeMatches =
      this.newAA === ZERO_U256 ? true : defaultAccountHash.bytecodeHash === this.newAA;

    const bootLoaderMsg = this.newBootLoader === ZERO_U256 ? "No changes" : this.newBootLoader;

    const bootLoaderBytecodeMatches =
      this.newBootLoader === ZERO_U256 ? true : bootLoaderHash.bytecodeHash === this.newBootLoader;

    otherContractsTable.push(["Default Account", this.oldAA, newAAMsg, aaBytecodeMatches ? chalk.green('Yes') : chalk.red('No')]);
    otherContractsTable.push([
      "Bootloader",
      this.oldBootLoader,
      bootLoaderMsg,
      bootLoaderBytecodeMatches ? chalk.green('Yes') : chalk.red('No'),
    ]);

    strings.push(otherContractsTable.toString());

    if (this.warnings.length !== 0) {
      strings.push('', chalk.red('Warning!!:'))
      strings.push(...this.warnings.map(w => `⚠️ ${w}`))
    }

    return strings.join("\n");
  }

  private async writeSystemContracts(
    filter: string[],
    baseDirOld: string,
    baseDirNew: string,
    l2Client: BlockExplorerClient,
    github: GithubClient,
    ref: string
  ) {
    const rawHashes = await github.downloadFile("system-contracts/SystemContractsHashes.json", ref);
    const hashes = systemContractHashesSchema.parse(JSON.parse(rawHashes));

    for (const change of this.systemContractChanges) {
      if (filter.length !== 0 && !filter.includes(`sc:${change.name}`)) {
        continue;
      }

      const currentHash = hashes.find((h) => h.contractName === change.name);

      if (!currentHash || change.proposedBytecodeHash !== currentHash.bytecodeHash) {
        throw new Error(`Bytecode hash does not match for ${change.name} inside ref "${ref}"`);
      }

      const [current, upgrade] = await Promise.all([
        change.downloadProposedCode(github, ref),
        change.downloadCurrentCode(l2Client),
      ]);

      current.remapKeys("system-contracts/contracts", "contracts-preprocessed");
      await current.writeSources(path.join(baseDirOld, "system-contracts", change.name));
      await upgrade.writeSources(path.join(baseDirNew, "system-contracts", change.name));
    }
  }
}
