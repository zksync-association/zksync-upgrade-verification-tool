// The upgrades list's time filter: the last 45 days (the default, as no upgrade still in progress
// is older), the last 90, or everything since the handler was deployed (?history=90 / all).
export const UPGRADE_WINDOWS = ["45", "90", "all"] as const;
export type UpgradeWindow = (typeof UPGRADE_WINDOWS)[number];

export const UPGRADE_WINDOW_LABELS: Record<UpgradeWindow, string> = {
  "45": "Last 45 days",
  "90": "Last 90 days",
  all: "All time",
};

export function upgradeWindow(raw: string | null | undefined): UpgradeWindow {
  return raw === "90" || raw === "all" ? raw : "45";
}
