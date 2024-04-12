import type { CryptoJson } from "./crypto";
import type { UpgradeManifest } from "./manifest";
import type { FacetCutsJson } from "./facetCuts";
import type { FacetsJson } from "./facets";
import type { l2UpgradeJson } from "./l2Upgrade";
import type { TransactionsJson } from "./transactions";

export * from "./common";
export * from "./manifest";
export * from "./crypto";
export * from "./etherscan";
export * from "./facetCuts";
export * from "./facets";
export * from "./l2Upgrade";
export * from "./transactions";

export type AllSchemas =
  | CryptoJson
  | FacetCutsJson
  | FacetsJson
  | l2UpgradeJson
  | UpgradeManifest
  | TransactionsJson;

export type SchemaMap = {
  [key: string]: AllSchemas;
};
