import type { FreezeAction } from "./execution";

export const FREEZE_ACTIONS = [
  "SoftFreeze",
  "HardFreeze",
  "Unfreeze",
  "SetSoftFreezeThreshold",
] as const satisfies readonly FreezeAction[];

export const FREEZE_SLUGS: Record<FreezeAction, string> = {
  SoftFreeze: "soft-freeze",
  HardFreeze: "hard-freeze",
  Unfreeze: "unfreeze",
  SetSoftFreezeThreshold: "set-soft-freeze-threshold",
};

export const FREEZE_LABELS: Record<FreezeAction, string> = {
  SoftFreeze: "Soft freeze",
  HardFreeze: "Hard freeze",
  Unfreeze: "Unfreeze",
  SetSoftFreezeThreshold: "Set soft-freeze threshold",
};

export function freezeActionFromSlug(slug: string): FreezeAction | null {
  return (
    (Object.entries(FREEZE_SLUGS).find(([, s]) => s === slug)?.[0] as FreezeAction | undefined) ??
    null
  );
}

/** The request page for exactly these signed values. */
export function freezePath(params: {
  action: FreezeAction;
  nonce: string;
  validUntil: string;
  threshold?: string;
}) {
  const query = new URLSearchParams({ nonce: params.nonce, validUntil: params.validUntil });
  if (params.action === "SetSoftFreezeThreshold") query.set("threshold", params.threshold ?? "");
  return `/app/freeze/${FREEZE_SLUGS[params.action]}?${query}`;
}
