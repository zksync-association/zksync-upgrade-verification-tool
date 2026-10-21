// Emergency upgrades prepared (or loaded) in this browser: their payloads are kept only here
// (payload-storage.ts), so the emergency list shows them before any member has signed, and after
// the tab that prepared them was closed. Each says where it stands by the page's own lists:
// pending in members' Safes (as Safe reports it), executed, or neither.
import type { EmergencySummary } from "@/.server/flows/emergency";
import { CopyButton, TxLink } from "@/components/hex";
import { ExecutedOn } from "@/components/verification/executed-on";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatTime, shortHex } from "@/utils/format";
import {
  type SavedPayload,
  forgetPayload,
  isPayloadChange,
  listPayloads,
} from "@/utils/payload-storage";
import type { SerializeFrom } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { ArrowRight, Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { $path } from "remix-routes";

type Summary = SerializeFrom<EmergencySummary>;

/** The payloads kept here: null until read (after hydration), and again on a change in a tab. */
export function useSavedPayloads() {
  const [saved, setSaved] = useState<SavedPayload[] | null>(null);
  useEffect(() => {
    const read = () => setSaved(listPayloads());
    read();
    const onStorage = (event: StorageEvent) => {
      if (isPayloadChange(event)) read();
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);
  return { saved, reread: () => setSaved(listPayloads()) };
}

export function PreparedEmergencies({
  saved,
  onRemoved,
  pending = null,
  executed = null,
}: {
  saved: SavedPayload[];
  onRemoved: () => void;
  /** The pending and executed lists of the page, once read (null until then). */
  pending?: Summary[] | null;
  executed?: Summary[] | null;
}) {
  const find = (list: Summary[] | null, id: string) =>
    list?.find((e) => e.id.toLowerCase() === id.toLowerCase());
  return (
    <Card className="divide-y divide-slate-200 overflow-hidden" data-testid="prepared-emergencies">
      {saved.map((s) => {
        const payload = (s.payload ?? {}) as { title?: unknown; calls?: unknown };
        const title = typeof payload.title === "string" && payload.title ? payload.title : null;
        const calls = Array.isArray(payload.calls) ? payload.calls.length : null;
        const done = find(executed, s.id);
        const signing = find(pending, s.id);
        return (
          <div
            key={s.id}
            className="group relative flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5 transition-colors hover:bg-slate-75 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-brand-600 has-[a:focus-visible]:ring-inset"
            data-testid="prepared-row"
          >
            <span className="min-w-0 flex-1 basis-full sm:basis-0">
              <span className="block font-semibold text-base text-navy-800">
                {title ?? "Untitled emergency upgrade"}
                {title && <span className="sr-only"> (its title is not signed)</span>}
              </span>
              <span className="flex items-center gap-1">
                <Link
                  to={$path("/app/emergency/:id", { id: s.id })}
                  className="mono text-[13px] text-navy-800 after:absolute after:inset-0 focus-visible:outline-none group-hover:text-brand-700"
                  title={s.id}
                >
                  {shortHex(s.id, 10, 8)}
                  <span className="sr-only"> (open the emergency upgrade)</span>
                </Link>
                <CopyButton value={s.id} label="Copy upgrade ID" className="relative z-10" />
              </span>
              <span className="block text-slate-550 text-xs">
                Prepared here {formatTime(Math.floor(s.savedAt / 1000))}
                {calls !== null && ` · ${calls} call${calls === 1 ? "" : "s"}`}
              </span>
            </span>
            <span
              className="relative z-10 flex flex-wrap items-center gap-1.5"
              data-testid="prepared-status"
            >
              {done?.executed ? (
                <>
                  <Badge variant="success">Executed</Badge>
                  <TxLink hash={done.executed.txHash} />
                  <ExecutedOn at={done.executed.timestamp} className="w-full" />
                </>
              ) : signing ? (
                <span
                  className="flex flex-wrap items-center gap-1.5"
                  title="As reported by Safe; open the upgrade to verify each signature on-chain"
                >
                  <Badge>Security Council {signing.reported.securityCouncil}</Badge>
                  <Badge>Guardians {signing.reported.guardians}</Badge>
                  <Badge>
                    {signing.reported.zkFoundation ? "Foundation signed" : "Foundation pending"}
                  </Badge>
                </span>
              ) : pending === null ? (
                <span className="text-slate-600 text-xs">Checking members' Safes…</span>
              ) : (
                <span className="text-[13px] text-slate-600">
                  No signatures pending in members' Safes
                </span>
              )}
            </span>
            <span className="relative z-10 flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadPayload(s.id, s.payload)}
                aria-label="Download payload.json"
                title="Download payload.json"
              >
                <Download />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove this emergency upgrade's payload from this browser? Without its calls and salt it cannot be checked or executed from here until the proposer shares them again. Download payload.json first if you still need it."
                    )
                  ) {
                    forgetPayload(s.id);
                    onRemoved();
                  }
                }}
                aria-label="Remove from this browser"
                title="Remove from this browser"
                data-testid="prepared-remove"
              >
                <Trash2 />
              </Button>
            </span>
            <ArrowRight
              aria-hidden
              className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700"
            />
          </div>
        );
      })}
    </Card>
  );
}

function downloadPayload(id: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `emergency-${id.slice(0, 10)}.json`;
  a.click();
}
