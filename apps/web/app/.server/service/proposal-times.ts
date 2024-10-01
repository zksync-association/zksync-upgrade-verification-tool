import { PROPOSAL_STATES, type StatusTime } from "@/utils/proposal-states";
import { EthereumConfig } from "@config/ethereum.server";

export function daysInSeconds(days: number): number {
  return days * 24 * 3600;
}

const SEVEN_DAYS_SECONDS = daysInSeconds(7);

// ProtocolUpgradeHandler.UPGRADE_WAIT_OR_EXPIRE_PERIOD
const WAITING_PERIOD_DURATION_DAYS = 30;

// This function recreates the schedulled described here: https://docs.zknation.io/zksync-governance/schedule-1-standard-governance-procedures.
// This is also enforce on chain by ProtocolUpgradeHandler.
// The 3 states that have expiration times are:
// -- LegalVetoPeriod: 3 days (0 in sepolia). Can be extended to 7. Starts on upgrade creation.
// -- Waiting: 30 days. Starts when veto period finishes.
// -- ExecutionPending. 1 day.
export function calculateStatusPendingDays(
  status: PROPOSAL_STATES,
  creationTimestamp: number,
  guardiansExtendedLegalVeto: boolean,
  latestBlockTimestamp: number
): StatusTime | null {
  if (status === PROPOSAL_STATES.LegalVetoPeriod) {
    const delta = latestBlockTimestamp - creationTimestamp;
    const currentDay = Math.ceil(delta / daysInSeconds(1));
    const totalDays = guardiansExtendedLegalVeto
      ? 7
      : EthereumConfig.standardProposalVetoPeriodDays;

    return {
      totalDays: totalDays,
      currentDay: currentDay,
    };
  }

  if (status === PROPOSAL_STATES.Waiting) {
    const baseVetoPeriodDuration = daysInSeconds(EthereumConfig.standardProposalVetoPeriodDays);
    const vetoPeriodDuration = guardiansExtendedLegalVeto
      ? SEVEN_DAYS_SECONDS
      : baseVetoPeriodDuration;
    const delta = latestBlockTimestamp - (creationTimestamp + vetoPeriodDuration);
    const currentDay = Math.ceil(delta / daysInSeconds(1));

    return {
      totalDays: WAITING_PERIOD_DURATION_DAYS,
      currentDay: currentDay,
    };
  }

  if (status === PROPOSAL_STATES.ExecutionPending) {
    return { totalDays: 1, currentDay: 1 };
  }

  return null;
}
