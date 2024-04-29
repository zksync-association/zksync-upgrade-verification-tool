import { z } from "zod";
import { account20String, bytes32Hash, hashString, transactionSchema } from "../schema";

const systemContractNames = z.enum([
  "AccountCodeStorage",
  "NonceHolder",
  "KnownCodesStorage",
  "ImmutableSimulator",
  "ContractDeployer",
  "L1Messenger",
  "MsgValueSimulator",
  "L2EthToken",
  "Keccak256",
  "SHA256",
  "Ecrecover",
  "EcAdd",
  "EcMul",
  "P256Verify",
  "CodeOracle",
  "SystemContext",
  "EventWriter",
  "BootloaderUtilities",
  "Compressor",
  "ComplexUpgrader",
  "EmptyContract",
  "PubdataChunkPublisher",
  "GasBoundCaller",
]);

const systemContracts = z.array(
  z.object({
    name: systemContractNames,
    bytecodeHashes: z.array(bytes32Hash),
    address: account20String,
  })
);

export const l2UpgradeSchema = z.object({
  systemContracts,
  defaultAA: z.object({
    name: z.literal("DefaultAccount"),
    bytecodeHashes: z.array(bytes32Hash),
  }),
  bootloader: z.object({
    name: z.literal("Bootloader"),
    bytecodeHashes: z.array(bytes32Hash),
  }),
  forcedDeployments: z.array(
    z.object({
      bytecodeHash: bytes32Hash,
      newAddress: account20String,
      value: z.number(),
      input: hashString,
      callConstructor: z.boolean(),
    })
  ),
  forcedDeploymentCalldata: hashString,
  calldata: hashString,
  tx: transactionSchema,
});

export type L2UpgradeJson = z.infer<typeof l2UpgradeSchema>;
