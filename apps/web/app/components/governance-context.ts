import type { AppStatus } from "@/.server/status";
import type { SerializeFrom } from "@remix-run/node";
import { createContext, useContext } from "react";

export type OkStatus = Extract<SerializeFrom<AppStatus>, { ok: true }>;
export const GovernanceContext = createContext<OkStatus | null>(null);

/** Only verified root status is provided; a pending read never becomes an OK status. */
export function useStatus(): OkStatus {
  const status = useContext(GovernanceContext);
  if (!status) throw new Error("App status unavailable");
  return status;
}
