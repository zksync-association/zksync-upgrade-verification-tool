import type { UpgradeTimeline } from "@/.server/flows/standard";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { formatTime, relativeTime } from "@/utils/format";
import type { ReactNode } from "react";
import type { TimelineStep } from "./timeline";

/** Under a step that has no time yet: what it waits for (a date in it, how far on hover). */
function StepNote({ children, at, now }: { children: ReactNode; at?: number; now: number }) {
  return (
    <p
      className="text-slate-500 text-xs"
      title={at === undefined ? undefined : relativeTime(at, now)}
    >
      {children}
    </p>
  );
}

function afterApproval(delaySeconds: number) {
  if (delaySeconds === 0) return "Once approved";
  const days = delaySeconds / 86_400;
  return Number.isInteger(days)
    ? `${days} day${days === 1 ? "" : "s"} after approval`
    : `${Math.round(delaySeconds / 3_600)} hours after approval`;
}

/**
 * A standard upgrade's steps, on the path it normally takes: the Security Council approves it after
 * the legal veto, and it is ready a day later. The Guardians' path (their approval takes effect 30
 * days after the legal veto) is shown only once they took it; an upgrade nobody approved in time
 * shows as expired.
 */
export function upgradeSteps({
  state,
  timeline: t,
  legalVetoExtended,
  guardiansApproved,
  now,
  executed,
}: {
  state: number;
  timeline: Pick<
    UpgradeTimeline,
    "createdAt" | "legalVetoEndsAt" | "waitingEndsAt" | "approvedAt" | "readyAt" | "delaySeconds"
  >;
  legalVetoExtended: boolean;
  guardiansApproved: boolean;
  now: number;
  /** The Executed step's time, once its transaction is found. */
  executed?: ReactNode;
}): TimelineStep[] {
  const expired = state === UPGRADE_STATES.Expired;
  const approval: TimelineStep =
    t.approvedAt !== null
      ? { label: "Approved by the Security Council", at: t.approvedAt, done: true }
      : guardiansApproved
        ? {
            label: "Approved by the Guardians",
            at: null,
            done: true,
            time: (
              <StepNote at={t.waitingEndsAt} now={now}>
                Takes effect {formatTime(t.waitingEndsAt)}
              </StepNote>
            ),
          }
        : expired
          ? { label: "Not approved in time", at: t.waitingEndsAt, done: false, failed: true }
          : {
              label: "Security Council approval",
              at: null,
              done: false,
              current: state === UPGRADE_STATES.Waiting,
              time:
                state === UPGRADE_STATES.LegalVetoPeriod ? (
                  <StepNote at={t.legalVetoEndsAt} now={now}>
                    From {formatTime(t.legalVetoEndsAt)}
                  </StepNote>
                ) : (
                  <StepNote at={t.waitingEndsAt} now={now}>
                    Due by {formatTime(t.waitingEndsAt)}
                  </StepNote>
                ),
            };
  return [
    { label: "Started on L1", at: t.createdAt, done: true },
    {
      label: legalVetoExtended ? "Legal veto (extended to 7 days)" : "Legal veto period",
      at: t.legalVetoEndsAt,
      done: now >= t.legalVetoEndsAt,
      current: state === UPGRADE_STATES.LegalVetoPeriod,
    },
    approval,
    {
      label: "Ready to execute",
      at: t.readyAt,
      done: state === UPGRADE_STATES.Ready || state === UPGRADE_STATES.Done,
      current: state === UPGRADE_STATES.ExecutionPending || state === UPGRADE_STATES.Ready,
      time:
        t.readyAt === null && !expired ? (
          <StepNote now={now}>{afterApproval(t.delaySeconds)}</StepNote>
        ) : undefined,
    },
    { label: "Executed", at: null, done: state === UPGRADE_STATES.Done, time: executed },
  ];
}
