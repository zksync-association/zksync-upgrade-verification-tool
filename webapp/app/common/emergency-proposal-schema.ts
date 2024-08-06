import { z } from "zod";
import { isAddress, padHex } from "viem";
import { zodHex } from "validate-cli/src";

export const emergencyPropSchema = z.object({
  title: z.string().min(1, "Title is required"),
  targetAddress: z.string().refine((value) => isAddress(value), {
    message: "Invalid Ethereum address",
  }),
  calldata: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/, "Calldata must be a hex string starting with 0x")
    .refine((value) => value.length % 2 === 0, {
      message: "Calldata must be valid hex-encoded bytes",
    }),
  salt: z
    .string()
    .regex(/^0x[a-fA-F0-9]*$/, "Salt must be a hex string starting with 0x")
    .refine((value) => value.length === 66, {
      message: "Salt must be a 32-byte hex string (64 characters)",
    })
    .default(padHex("0x0")),
  value: z
    .string()
    .regex(/^\d*\.?\d*$/, "Value must be a positive number")
    .refine((value) => Number.parseFloat(value) >= 0, {
      message: "Value must be a positive number",
    }),
});

export const fullEmergencyPropSchema = emergencyPropSchema.extend({
  proposer: zodHex
})

export type EmergencyProp = z.infer<typeof emergencyPropSchema>;

export type FullEmergencyProp = z.infer<typeof fullEmergencyPropSchema>