import { z, type ZodTypeAny } from "zod";

export const zodStringToNumberPipe = (zodPipe: ZodTypeAny) =>
  z
    .string()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine((value) => value === null || !Number.isNaN(value), {
      message: "Invalid number",
    })
    .transform((value) => (value === null ? null : Number(value)))
    .pipe(zodPipe);

export const zodStringToBigIntPipe = (zodPipe: ZodTypeAny) =>
  z
    .string()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine((value) => value === null || !Number.isNaN(value), {
      message: "Invalid number",
    })
    .transform((value) => (value === null ? null : BigInt(value)))
    .pipe(zodPipe);
