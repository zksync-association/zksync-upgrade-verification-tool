import { z } from "zod";
import { getAddress, Hex } from "viem";

const hexRegexp = /0x[0-9a-fA-F]*/;

const hexChars = z.string()
  .refine((str) => hexRegexp.test(str), "Not a valid hex")

export const hexSchema = hexChars
  .refine(str => str.length % 2 === 0, "Cannot have odd number of digits in hex string")
  .transform(str => str as Hex )

const digitsSchema = z.string()
  .refine((str) => /[0-9]+/.test(str), "Not a numerical string")


const addressSchema = hexChars
  .refine(str => str.length === 42, "Address have to be 20 bytes long")
  .transform(str => getAddress(str))


export const callSchema = z.object({
  target: hexSchema,
  data: hexSchema,
  value: z.coerce.bigint()
})

export type Call = {
  target: Hex,
  data: Hex,
  value: bigint
}

export const formCallSchema = z.object({
  target: addressSchema,
  data: hexSchema,
  value: digitsSchema
})

export type FormCall = z.infer<typeof formCallSchema>

export function encodeCall(call: Call): FormCall {
  return {
    ...call,
    value: call.value.toString()
  }
}

export function decodeCall(formCall: FormCall): Call {
  return callSchema.parse(formCall)
}