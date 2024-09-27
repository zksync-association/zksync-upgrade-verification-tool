import { VerifierContract } from "./verifier.js";
import type { Hex } from "viem";
import { Option } from "nochoices";
import type { UpgradeManifest } from "./schema/manifest.js";
import type { TransactionsJson } from "./schema/transactions.js";
import type { FacetsJson } from "./schema/facets.js";
import type { L2UpgradeJson } from "./schema/l2Upgrade.js";

export type FacetData = {
  name: string;
  address: Hex;
  selectors: Hex[];
};

export type SystemContractData = {
  address: Hex;
  codeHash: Hex;
  name: string;
};

export class UpgradeChanges {
  facets: FacetData[];
  orphanedSelectors: Hex[];
  verifier: VerifierContract;
  systemContractChanges: SystemContractData[];
  aaBytecodeHash: string;
  bootloaderBytecodeHash: string;
  upgradeCalldataHex: Option<Hex>;

  constructor(
    verifier: VerifierContract,
    aaBytecodeHash: string,
    bootloaderBytecodeHash: string,
    upgradeTxHex?: Hex
  ) {
    this.facets = [];
    this.orphanedSelectors = [];
    this.systemContractChanges = [];
    this.verifier = verifier;
    this.aaBytecodeHash = aaBytecodeHash;
    this.bootloaderBytecodeHash = bootloaderBytecodeHash;
    this.upgradeCalldataHex = Option.fromNullable(upgradeTxHex);
  }

  // matchingFacet(targetSelectors: string[]): FacetData | undefined {
  //   return this.facets.find((f) => f.selectors.some((sel) => targetSelectors.includes(sel)));
  // }

  addFacet(facetName: string, facetAddr: Hex, selectors: string[]) {
    this.orphanedSelectors = this.orphanedSelectors.filter(
      (selector) => !selectors.includes(selector)
    );

    this.facets.push({
      name: facetName,
      address: facetAddr,
      selectors: selectors as Hex[],
    });
  }

  removeFacet(selectors: string[]) {
    this.orphanedSelectors.push(...(selectors as Hex[]));
  }

  addSystemContract(change: SystemContractData) {
    this.systemContractChanges.push(change);
  }

  static fromFiles(
    _common: UpgradeManifest,
    txFile: TransactionsJson,
    facets?: FacetsJson,
    l2Upgrade?: L2UpgradeJson
  ): UpgradeChanges {
    const jsonCuts = txFile.transparentUpgrade.facetCuts;
    const verifier = new VerifierContract(
      txFile.proposeUpgradeTx.verifier,
      txFile.proposeUpgradeTx.verifierParams.recursionCircuitsSetVksHash,
      txFile.proposeUpgradeTx.verifierParams.recursionLeafLevelVkHash,
      txFile.proposeUpgradeTx.verifierParams.recursionNodeLevelVkHash
    );

    const instance = new UpgradeChanges(
      verifier,
      txFile.proposeUpgradeTx.defaultAccountHash,
      txFile.proposeUpgradeTx.bootloaderHash,
      txFile.governanceOperation?.calls[0]?.data
    );

    if (facets) {
      const facetDefs = Object.keys(facets).map((name) => {
        return {
          name: name,
          ...facets[name],
        };
      });

      for (const cut of jsonCuts) {
        if (cut.action === 2) {
          instance.removeFacet(cut.selectors);
        } else if (cut.action === 0) {
          const facetDef = facetDefs.find((f) => f.address === cut.facet);
          if (!facetDef || !facetDef.address) {
            throw new Error(`Inconsistent data. ${cut.facet} not present in facets.json`);
          }
          instance.addFacet(facetDef.name, facetDef.address, cut.selectors);
        } else {
          // TODO: Handle upgrade
          throw new Error("Upgrade action not supported yet");
        }
      }
    }

    const systemContracts = l2Upgrade?.systemContracts || [];
    for (const contract of systemContracts) {
      instance.addSystemContract({
        name: contract.name,
        codeHash: contract.bytecodeHashes[0] as Hex,
        address: contract.address as Hex,
      });
    }

    return instance;
  }

  allSelectors(): Hex[] {
    return this.facets.flatMap((f) => f.selectors).concat(this.orphanedSelectors);
  }

  allFacetsAddresses(): Hex[] {
    return this.facets.map((f) => f.address);
  }
}
