import { z } from "zod";

export const EthNetworkEnum = z.enum(["mainnet", "sepolia", "local"]);
export type EthNetwork = z.infer<typeof EthNetworkEnum>;
