import {z} from "zod";


export const initCallDataSchema = z.object({
  l2ProtocolUpgradeTx: z.object({
    txType: z.bigint(),
    from: z.bigint(),
    to: z.bigint(),
    gasLimit: z.bigint(),
    gasPerPubdataByteLimit: z.bigint(),
    maxFeePerGas: z.bigint(),
    maxPriorityFeePerGas: z.bigint(),
    paymaster: z.bigint(),
    nonce: z.bigint(),
    value: z.bigint(),
    reserved: z.array(z.bigint()),
    data: z.string()
  }),
  bootloaderHash: z.string(),
  defaultAccountHash: z.string(),
  verifier: z.string(),
  verifierParams: z.object({
    recursionNodeLevelVkHash: z.string(),
    recursionLeafLevelVkHash: z.string(),
    recursionCircuitsSetVksHash: z.string()
  }),
  l1ContractsUpgradeCalldata: z.string(),
  postUpgradeCalldata: z.string(),
  upgradeTimestamp: z.bigint(),
  newProtocolVersion: z.bigint(),
  newAllowList: z.string()
})

// export type InitCallData = z.infer<typeof initCallDataSchema>