// How far back the start page looks for executed ZkProtocolGovernor proposals: 30 days unless the
// page asks for another number of days (whole days, at most ten years).
export const STARTABLE_DAYS = 30;
export const MAX_STARTABLE_DAYS = 3_650;

export function startableDays(raw: string | null): number {
  const days = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isInteger(days) || days < 1)
    return STARTABLE_DAYS;
  return Math.min(days, MAX_STARTABLE_DAYS);
}
