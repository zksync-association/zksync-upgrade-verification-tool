import {
  commonJsonSchema,
  cryptoSchema,
  facetCutsSchema,
  facetsSchema,
  l2UpgradeSchema,
  transactionsSchema,
} from "../schema";

export const SCHEMAS = {
  'common.json': commonJsonSchema,
  'crypto.json': cryptoSchema,
  'facetCuts.json': facetCutsSchema,
  'facets.json': facetsSchema,
  'l2Upgrade.json': l2UpgradeSchema,
  'transactions.json': transactionsSchema,
};
