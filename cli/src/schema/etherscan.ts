import {z} from "zod"
import { numberString } from "./common"
import type Abi from "viem"



export const getAbiSchema = z.object({
    status: numberString,
    message: z.enum(["OK", "NOTOK"]),
    result: z.string()
})

export type GetAbiSchema = z.infer<typeof getAbiSchema>