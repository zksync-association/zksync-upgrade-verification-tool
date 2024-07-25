import { PROPOSAL_STATES, type StatusTime } from "@/utils/proposal-states";

export function daysInSeconds(days: number): number {
  return days * 24 * 3600;
}

const THREE_DAYS_SECONDS = daysInSeconds(3);
const SEVEN_DAYS_SECONDS = daysInSeconds(7);

// ProtocolUpgradeHandler.UPGRADE_WAIT_OR_EXPIRE_PERIOD
const WAITING_PERIOD_DURATION_DAYS = 30;


// This function recreates the schedulled described here: https://docs.zknation.io/zksync-governance/schedule-1-standard-governance-procedures.
// This is also enforce on chain by ProtocolUpgradeHandler.
// The 3 states that have expiration times are:
// -- LegalVetoPeriod: 3 days. Can be extended to 7. Starts on upgrade creation.
// -- Waiting: 30 days. Starts when veto period finishes.
// -- ExecutionPending. 1 day.
export function calculateStatusPendingDays(
  status: PROPOSAL_STATES,
  creationTimestamp: number,
  guardiansExtendedLegalVeto: boolean,
  nowInSeconds: number
): StatusTime | null {
  if (status === PROPOSAL_STATES.LegalVetoPeriod) {
    const delta = nowInSeconds - creationTimestamp;
    const currentDay = Math.ceil(delta / daysInSeconds(1));
    const totalDays = guardiansExtendedLegalVeto ? 7 : 3;

    return {
      totalDays: totalDays,
      currentDay: currentDay,
    };
  }

  if (status === PROPOSAL_STATES.Waiting) {
    const vetoPeriodDuration = guardiansExtendedLegalVeto
      ? SEVEN_DAYS_SECONDS
      : THREE_DAYS_SECONDS;
    const delta = nowInSeconds - (creationTimestamp + vetoPeriodDuration);
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
