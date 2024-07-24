import { PROPOSAL_STATES, type StatusTime } from "@/utils/proposal-states";

export function daysInSeconds(days: number): number {
  return days * 24 * 3600;
}

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
    const days3 = daysInSeconds(3);
    const days7 = daysInSeconds(7);
    const vetoPeriodDuration = guardiansExtendedLegalVeto ? days7 : days3;
    const delta = nowInSeconds - (creationTimestamp + vetoPeriodDuration);
    const currentDay = Math.ceil(delta / daysInSeconds(1));
    return {
      totalDays: 30,
      currentDay: currentDay,
    };
  }

  if (status === PROPOSAL_STATES.ExecutionPending) {
    return { totalDays: 1, currentDay: 1 };
  }

  return null;
}
