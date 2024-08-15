import { addressSchema } from "@/common/basic-schemas";
import { padHex } from "viem";
import { z } from "zod";

export const fullEmergencyPropSchema = z.object({
  title: z.string().min(1, "Title is required"),
  salt: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/, "Salt must be a hex string starting with 0x")
    .refine((value) => value.length === 66, {
      message: "Salt must be a 32-byte hex string (64 characters)",
    })
    .default(padHex("0x0")),
  proposer: addressSchema,
});

export type FullEmergencyProp = z.infer<typeof fullEmergencyPropSchema>;
