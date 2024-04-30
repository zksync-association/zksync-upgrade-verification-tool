import type {
  FacetsJson,
  L2UpgradeJson,
  TransactionsJson,
  UpgradeManifest,
} from "../schema/index.js";
import { VerifierContract } from "./verifier.js";
import type { Hex } from "viem";

export type FacetData = {
  name: string;
  address: string;
  selectors: string[];
};

export type SystemContractData = {
  address: Hex;
  codeHash: Hex;
  name: string;
};

export class UpgradeChanges {
  newProtocolVersion: string;
  facets: FacetData[];
  orphanedSelectors: string[];
  verifier: VerifierContract;
  systemCotractChanges: SystemContractData[];
  aaBytecodeHash: string;
  booloaderBytecodeHash: string;

  constructor(
    newProtocolVersion: string,
    verifier: VerifierContract,
    aaBytecodeHash: string,
    booloaderBytecodeHash: string
  ) {
    this.newProtocolVersion = newProtocolVersion;
    this.facets = [];
    this.orphanedSelectors = [];
    this.systemCotractChanges = [];
    this.verifier = verifier;
    this.aaBytecodeHash = aaBytecodeHash;
    this.booloaderBytecodeHash = booloaderBytecodeHash;
  }

  facetAffected(name: string): FacetData | undefined {
    return this.facets.find((f) => f.name === name);
  }

  addFacet(facetName: string, facetAddr: string, selectors: string[]) {
    this.orphanedSelectors = this.orphanedSelectors.filter(
      (selector) => !selectors.includes(selector)
    );

    this.facets.push({
      name: facetName,
      address: facetAddr,
      selectors: selectors,
    });
  }

  removeFacet(selectors: string[]) {
    this.orphanedSelectors.push(...selectors);
  }

  addSystemContract(change: SystemContractData) {
    this.systemCotractChanges.push(change);
  }

  static fromFiles(
    common: UpgradeManifest,
    txFile: TransactionsJson,
    facets?: FacetsJson,
    l2Upgrade?: L2UpgradeJson
  ): UpgradeChanges {
    const jsonCuts = txFile.transparentUpgrade.facetCuts;
    const verifier = new VerifierContract(
      txFile.proposeUpgradeTx.verifier,
      txFile.proposeUpgradeTx.verifierParams.recursionCircuitsSetVksHash,
      txFile.proposeUpgradeTx.verifierParams.recursionNodeLevelVkHash,
      txFile.proposeUpgradeTx.verifierParams.recursionLeafLevelVkHash
    );

    const instance = new UpgradeChanges(
      common.protocolVersion.toString(),
      verifier,
      txFile.proposeUpgradeTx.defaultAccountHash,
      txFile.proposeUpgradeTx.bootloaderHash
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
          if (!facetDef) {
            throw new Error(`Inconsistent data. ${cut.facet} not present in facets.json`);
          }
          instance.addFacet(facetDef.name, facetDef.address, cut.selectors);
        } else {
          // TODO: Handle upgrade
          throw new Error("Upgrade action not suported yet");
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
}
