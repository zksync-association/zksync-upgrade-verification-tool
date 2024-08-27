export enum L2_CANCELLATION_STATES {
  Pending = 0,
  Active = 1,
  Canceled = 2,
  Defeated = 3,
  Succeeded = 4,
  Queued = 5,
  Expired = 6,
  Executed = 7,
}

export const VALID_CANCELLATION_STATES = [
  L2_CANCELLATION_STATES.Active,
  L2_CANCELLATION_STATES.Pending,
];

export function isValidCancellationState(state: L2_CANCELLATION_STATES | undefined): boolean {
  return VALID_CANCELLATION_STATES.some((s) => s === state);
}
