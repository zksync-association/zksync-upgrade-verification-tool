import {
  commonJsonSchema,
  cryptoSchema,
  facetCutsSchema,
  facetsSchema,
  l2UpgradeSchema,
  transactionsSchema,
} from "../schema";
import { z } from "zod";

export const knownFileNames = z.enum([
  "common.json",
  "crypto.json",
  "facetCuts.json",
  "facets.json",
  "l2Upgrade.json",
  "transactions.json",
]);

export const SCHEMAS = {
  "common.json": commonJsonSchema,
  "crypto.json": cryptoSchema,
  "facetCuts.json": facetCutsSchema,
  "facets.json": facetsSchema,
  "l2Upgrade.json": l2UpgradeSchema,
  "transactions.json": transactionsSchema,
};
