import emergencyUpgradeBoardArtifact from "@repo/contracts/artifacts/EmergencyUpgradeBoard/EmergencyUpgradeBoard.json";
import type { EmergencyUpgradeBoard$Type } from "@repo/contracts/artifacts/EmergencyUpgradeBoard/EmergencyUpgradeBoard.d.ts";
import guardiansArtifact from "@repo/contracts/artifacts/Guardians/Guardians.json";
import type { Guardians$Type } from "@repo/contracts/artifacts/Guardians/Guardians.d.ts";
import upgradeHandlerArtifact from "@repo/contracts/artifacts/ProtocolUpgradeHandler/ProtocolUpgradeHandler.json";
import type { ProtocolUpgradeHandler$Type } from "@repo/contracts/artifacts/ProtocolUpgradeHandler/ProtocolUpgradeHandler.d.ts";
import securityCouncilArtifact from "@repo/contracts/artifacts/SecurityCouncil/SecurityCouncil.json";
import type { SecurityCouncil$Type } from "@repo/contracts/artifacts/SecurityCouncil/SecurityCouncil.d.ts";
import zkGovOpsGovernorArtifact from "@repo/contracts/artifacts/ZkGovOpsGovernor/ZkGovOpsGovernor.json";
import type { ZkGovOpsGovernor$Type } from "@repo/contracts/artifacts/ZkGovOpsGovernor/ZkGovOpsGovernor.d.ts";
import zkProtocolGovernorArtifact from "@repo/contracts/artifacts/ZkProtocolGovernor/ZkProtocolGovernor.json";
import type { ZkProtocolGovernor$Type } from "@repo/contracts/artifacts/ZkProtocolGovernor/ZkProtocolGovernor.d.ts";

export const emergencyUpgradeBoardAbi =
  emergencyUpgradeBoardArtifact.abi as EmergencyUpgradeBoard$Type["abi"];

export const guardiansAbi = guardiansArtifact.abi as Guardians$Type["abi"];

export const upgradeHandlerAbi = upgradeHandlerArtifact.abi as ProtocolUpgradeHandler$Type["abi"];

export const securityCouncilAbi = securityCouncilArtifact.abi as SecurityCouncil$Type["abi"];

export const zkGovOpsGovernorAbi = zkGovOpsGovernorArtifact.abi as ZkGovOpsGovernor$Type["abi"];

export const zkProtocolGovernorAbi =
  zkProtocolGovernorArtifact.abi as ZkProtocolGovernor$Type["abi"];
