import {
  EMERGENCY_BOARD_ABI,
  GUARDIANS_RAW_ABI,
  PROTOCOL_UPGRADE_HANDLER_RAW_ABI,
  SEC_COUNCIL_RAW_ABI,
  ZK_GOV_OPS_GOVERNOR_ABI,
  ZK_TOKEN_GOVERNOR_ABI,
} from "@/utils/raw-abis";
import { ContractAbi } from "validate-cli";

export const upgradeHandlerAbi = new ContractAbi(PROTOCOL_UPGRADE_HANDLER_RAW_ABI);
export const guardiansAbi = new ContractAbi(GUARDIANS_RAW_ABI);
export const scAbi = new ContractAbi(SEC_COUNCIL_RAW_ABI);
export const emergencyBoardAbi = new ContractAbi(EMERGENCY_BOARD_ABI);
export const zkGovOpsGovernorAbi = new ContractAbi(ZK_GOV_OPS_GOVERNOR_ABI);
export const zkTokenGovernorAbi = new ContractAbi(ZK_TOKEN_GOVERNOR_ABI);
