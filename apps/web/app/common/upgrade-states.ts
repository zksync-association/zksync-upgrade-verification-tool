// IProtocolUpgradeHandler.UpgradeState
export const UPGRADE_STATES = {
  None: 0,
  LegalVetoPeriod: 1,
  Waiting: 2,
  ExecutionPending: 3,
  Ready: 4,
  Expired: 5,
  Done: 6,
} as const;

export type UpgradeState = (typeof UPGRADE_STATES)[keyof typeof UPGRADE_STATES];

export const UPGRADE_STATE_LABELS: Record<UpgradeState, string> = {
  0: "Not started",
  1: "Legal veto period",
  2: "Waiting for approval",
  3: "Execution pending",
  4: "Ready to execute",
  5: "Expired",
  6: "Executed",
};

export function isUpgradeActive(state: UpgradeState) {
  return (
    state !== UPGRADE_STATES.Expired &&
    state !== UPGRADE_STATES.Done &&
    state !== UPGRADE_STATES.None
  );
}

// IProtocolUpgradeHandler.FreezeStatus
export const FREEZE_STATUS_LABELS: Record<number, string> = {
  0: "Not frozen this upgrade cycle",
  1: "Soft frozen",
  2: "Hard frozen",
  3: "Unfrozen after a soft freeze",
  4: "Unfrozen after a hard freeze",
};
