import type { ZkSyncEraDiff } from "../zk-sync-era-diff.js";
import {
  ADDR_ZKSYNC_FIELDS,
  BYTES32_ZKSYNC_FIELDS,
  NUMERIC_ZKSYNC_FIELDS,
} from "../zksync-era-state.js";
import type { Hex } from "viem";
import type { Option } from "nochoices";
import type { BlockExplorer } from "../../etherscan/block-explorer-client";

export type SystemContractUpgrade = {
  name: string;
  address: Hex;
  currentBytecodeHash?: string;
  proposedBytecodeHash?: Hex;
  recompileMatches: boolean;
};

type FieldChangeType = "number" | "address" | "bytes32";

export type ContractFieldChange = {
  name: string;
  type: FieldChangeType;
  current: string | null;
  proposed: string | null;
};

export type FacetDataReportDiff = {
  name: string;
  oldAddress?: string;
  newAddress?: string;
  addedFunctions: string[];
  removedFunctions: string[];
  preservedFunctions: string[];
};

export type CheckReportObj = {
  metadata: {
    currentVersion: string;
    proposedVersion: string;
  };
  facetChanges: FacetDataReportDiff[];
  systemContractChanges: SystemContractUpgrade[];
  fieldChanges: ContractFieldChange[];
};

export class ObjectCheckReport {
  private diff: ZkSyncEraDiff;
  private explorer: BlockExplorer;

  constructor(diff: ZkSyncEraDiff, explorer: BlockExplorer) {
    this.diff = diff;
    this.explorer = explorer;
  }

  async format(): Promise<CheckReportObj> {
    const [currentVersion, proposedVersion] = this.diff.protocolVersion();
    return {
      metadata: {
        currentVersion,
        proposedVersion,
      },
      facetChanges: await this.getFacets(),
      systemContractChanges: await this.addSystemContracts(),
      fieldChanges: this.addFields(),
    };
  }

  private async getFacets(): Promise<FacetDataReportDiff[]> {
    const promises = [
      ...this.diff.upgradedFacets(),
      ...this.diff.addedFacets(),
      ...this.diff.removedFacets(),
    ].map(async (facet) => {
      const abi1 = facet.oldAddress.isSome()
        ? await this.explorer.getAbi(facet.oldAddress.unwrap())
        : undefined;

      const abi2 = facet.newAddress.isSome()
        ? await this.explorer.getAbi(facet.newAddress.unwrap())
        : undefined;

      const someAbi = abi1 || abi2;

      return {
        name: facet.name,
        oldAddress: this.orUndefined(facet.oldAddress),
        newAddress: this.orUndefined(facet.newAddress),
        removedFunctions: abi1
          ? facet.removedSelectors.map((sel) => abi1.signatureForSelector(sel))
          : facet.removedSelectors,
        preservedFunctions: someAbi
          ? facet.preservedSelectors.map((sel) => someAbi.signatureForSelector(sel))
          : facet.preservedSelectors,
        addedFunctions: abi2
          ? facet.addedSelectors.map((sel) => abi2.signatureForSelector(sel))
          : facet.addedSelectors,
      };
    });

    return Promise.all(promises);
  }

  private addFields(): ContractFieldChange[] {
    const res: ContractFieldChange[] = [];
    for (const field of ADDR_ZKSYNC_FIELDS) {
      const [before, maybeAfter] = this.diff.hexAttrDiff(field);
      res.push({
        name: field,
        current: before,
        type: "address",
        proposed: this.orNull(maybeAfter),
      });
    }

    for (const field of BYTES32_ZKSYNC_FIELDS) {
      const [before, maybeAfter] = this.diff.hexAttrDiff(field);
      res.push({
        name: field,
        current: before,
        type: "bytes32",
        proposed: this.orNull(maybeAfter),
      });
    }

    for (const field of NUMERIC_ZKSYNC_FIELDS) {
      const [before, maybeAfter] = this.diff.numberAttrDiff(field);
      res.push({
        name: field,
        current: before.toString(),
        type: "number",
        proposed: this.orNull(maybeAfter.map((v) => v.toString())),
      });
    }

    return res;
  }

  private orUndefined<T>(opt: Option<T>): T | undefined {
    return opt.map((v): T | undefined => v).unwrapOr(undefined);
  }

  private orNull<T>(opt: Option<T>): T | null {
    return opt.map((v): T | null => v).unwrapOr(null);
  }

  private async addSystemContracts(): Promise<SystemContractUpgrade[]> {
    const changes = await this.diff.systemContractChanges();

    return changes.map((c) => ({
      name: c.name,
      address: c.address,
      proposedBytecodeHash: c.proposedBytecodeHash,
      currentBytecodeHash: this.orUndefined(c.currentBytecodeHash),
      recompileMatches: true,
    }));
  }
}
