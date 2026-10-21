import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { AlertTriangle, FileJson, ShieldAlert } from "lucide-react";

type Role = { set: { valid: readonly unknown[]; members: readonly { status: string }[] } };

/** Whether any group has started signing: a valid signature, or a Safe collecting its owners'. */
export function hasSignatures(roles: readonly Role[]): boolean {
  return roles.some(
    (r) => r.set.valid.length > 0 || r.set.members.some((m) => m.status === "collecting")
  );
}

/** The payload loaded in this browser, checked against the id; null when none is. */
type Check = { ok: boolean } | null;

const MISMATCH_TEXT =
  "Its calls do not hash to this id, so they are not what is signed. Do not sign or execute this upgrade from it: ask the proposer for the payload of this id.";

/**
 * Members of an emergency upgrade sign only its id, never what it runs. Until the viewer has a
 * payload that hashes to the id, the page says so before anything else, and a payload that does
 * not match is not to be relied on. Nothing once it matches.
 */
export function UncheckedPayloadWarning({
  roles,
  check,
  onLoad,
}: {
  roles: readonly Role[];
  check: Check;
  /** Takes the viewer to where the payload is loaded. */
  onLoad: () => void;
}) {
  if (check?.ok) return null;
  const mismatch = check !== null;
  const Icon = mismatch ? ShieldAlert : AlertTriangle;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-4 sm:px-5",
        mismatch
          ? "border-red-700 bg-red-50 text-red-900"
          : "border-amber-600 bg-amber-50 text-amber-950"
      )}
      role="alert"
      data-testid="unchecked-payload"
      data-kind={mismatch ? "mismatch" : "missing"}
    >
      <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-semibold text-[15px]">
          {mismatch
            ? "The payload you loaded does not match this id"
            : "Check the payload before you sign or execute"}
        </p>
        <p className="max-w-3xl text-[14px] leading-relaxed">
          {mismatch
            ? MISMATCH_TEXT
            : `${hasSignatures(roles) ? "Members have already signed this emergency upgrade, but a" : "A"} signature covers only its id, not the calls it runs. This page has not checked what the upgrade will do: load the payload JSON the proposer shared and make sure it matches this id.`}
        </p>
        <div className="pt-1.5">
          <Button size="sm" variant={mismatch ? "destructive" : "default"} onClick={onLoad}>
            <FileJson /> {mismatch ? "Load another payload" : "Load the payload"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The same, said in the review before signing (the page's warning may be scrolled away). */
export function UncheckedPayloadNote({ check }: { check: Check }) {
  if (check?.ok) return null;
  const mismatch = check !== null;
  const Icon = mismatch ? ShieldAlert : AlertTriangle;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13.5px]",
        mismatch
          ? "border-red-700 bg-red-50 text-red-900"
          : "border-amber-600 bg-amber-50 text-amber-950"
      )}
      role="alert"
      data-testid="unchecked-payload-note"
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">
          {mismatch
            ? "The payload you loaded does not match this id"
            : "You have not checked this upgrade's payload"}
        </p>
        <p className="leading-relaxed">
          {mismatch
            ? MISMATCH_TEXT
            : "Your signature covers only this id, not the calls it runs. Close this, load the payload the proposer shared on the page, and sign only once it matches this id."}
        </p>
      </div>
    </div>
  );
}
