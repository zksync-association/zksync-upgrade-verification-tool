import { ContractAbi } from "validate-cli/src/lib/contract-abi";
import { GUARDIANS_RAW_ABI, PROTOCOL_UPGRADE_HANDLER_RAW_ABI, SEC_COUNCIL_RAW_ABI } from "@/utils/raw-abis";

export const upgradeHandlerAbi = new ContractAbi(PROTOCOL_UPGRADE_HANDLER_RAW_ABI);
export const guardiansAbi = new ContractAbi(GUARDIANS_RAW_ABI);
export const scAbi = new ContractAbi(SEC_COUNCIL_RAW_ABI);
