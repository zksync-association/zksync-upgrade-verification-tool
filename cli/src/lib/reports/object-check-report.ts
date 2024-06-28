import { type FacetDataDiff, type ZkSyncEraDiff } from "../zk-sync-era-diff";
import type { BlockExplorer } from "../block-explorer-client";
import {
  HEX_ZKSYNC_FIELDS,
  type HexEraPropName,
  type NumberEraPropNames,
  NUMERIC_ZKSYNC_FIELDS,
} from "../zksync-era-state";
import type { Hex } from "viem";
import type { Option } from "nochoices";

export type SystemContractChange = {
  name: string;
  address: Hex;
  currentBytecodeHash?: string;
  proposedBytecodeHash?: Hex;
  recompileMatches: boolean;
};

export type ContractFieldChanges = {
  [key in HexEraPropName]?: {
    current?: string;
    proposed?: string;
  };
} & {
  [key in NumberEraPropNames]?: {
    current?: string;
    proposed?: string;
  };
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
  systemContractChanges: SystemContractChange[];
  fieldChanges: ContractFieldChanges;
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

  private addFields(): ContractFieldChanges {
    const res: ContractFieldChanges = {};
    for (const field of HEX_ZKSYNC_FIELDS) {
      const [before, maybeAfter] = this.diff.hexAttrDiff(field);

      const after: Hex | undefined = maybeAfter
        .map((v): Hex | undefined => v || undefined)
        .unwrapOr(undefined);
      res[field] = {
        current: before,
        proposed: after,
      };
    }

    for (const field of NUMERIC_ZKSYNC_FIELDS) {
      const [before, maybeAfter] = this.diff.numberAttrDiff(field);

      res[field] = {
        current: before.toString(),
        proposed: this.orUndefined(maybeAfter.map((v) => v.toString())),
      };
    }

    return res;
  }

  private orUndefined<T>(opt: Option<T>): T | undefined {
    return opt.map((v): T | undefined => v).unwrapOr(undefined);
  }

  private addTitle(lines: string[], title: string): void {
    lines.push(title);
    lines.push("=".repeat(title.length));
    lines.push("");
  }

  private async addSystemContracts(): Promise<SystemContractChange[]> {
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
