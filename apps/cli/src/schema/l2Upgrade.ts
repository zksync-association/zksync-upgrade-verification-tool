import { addressSchema, bytes32Schema } from "@repo/common/schemas";
import { z } from "zod";

const systemContracts = z.array(
  z.object({
    name: z.string(),
    bytecodeHashes: z.array(bytes32Schema),
    address: addressSchema,
  })
);

export const l2UpgradeSchema = z.object({
  systemContracts,
});

export type L2UpgradeJson = z.infer<typeof l2UpgradeSchema>;
