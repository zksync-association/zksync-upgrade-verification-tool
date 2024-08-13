import { addressSchema, hexSchema } from "@/common/basic-schemas";
import { callSchema } from "@/common/calls";
import { padHex } from "viem";
import { z } from "zod";

export const basicPropSchema = z.object({
  salt: hexSchema,
});

export const emergencyPropSchema = basicPropSchema.extend({
  title: z.string().min(1, "Title is required"),
  salt: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/, "Salt must be a hex string starting with 0x")
    .refine((value) => value.length === 66, {
      message: "Salt must be a 32-byte hex string (64 characters)",
    })
    .default(padHex("0x0")),
});

export const fullEmergencyPropSchema = emergencyPropSchema.extend({
  proposer: addressSchema,
});

export type EmergencyProp = z.infer<typeof emergencyPropSchema>;

export type FullEmergencyProp = z.infer<typeof fullEmergencyPropSchema>;
