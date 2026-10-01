import type { SetState } from "@/.server/flows/common";
import type { MemberStatus, SignatureSource } from "@/.server/signatures";
import { UPGRADE_STATE_LABELS, type UpgradeState } from "@/common/upgrade-states";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleDashed, CircleSlash, Clock, XCircle } from "lucide-react";

export function UpgradeStateBadge({ state }: { state: UpgradeState }) {
  const variant =
    state === 6
      ? "success"
      : state === 5
        ? "error"
        : state === 4
          ? "info"
          : state === 0
            ? "neutral"
            : "warning";
  return (
    <Badge variant={variant} data-testid="upgrade-state">
      {UPGRADE_STATE_LABELS[state]}
    </Badge>
  );
}

export function SetStateBadge({ state }: { state: SetState }) {
  if (state.status === "open") {
    return (
      <Badge variant="info">
        <Clock /> Open for signatures
      </Badge>
    );
  }
  if (state.status === "done") {
    return (
      <Badge variant="success">
        <CheckCircle2 /> Done on-chain
      </Badge>
    );
  }
  return (
    <Badge variant="neutral">
      <CircleSlash /> Closed
    </Badge>
  );
}

const SOURCE_LABEL: Record<SignatureSource, string> = {
  safe: "from Safe",
  onchain: "approved on-chain",
  supplied: "supplied in URL",
};

export function MemberStatusBadge({
  status,
  source,
  confirmations,
  safeThreshold,
}: {
  status: MemberStatus;
  source: SignatureSource | null;
  confirmations: number | null;
  safeThreshold: number | null;
}) {
  switch (status) {
    case "valid":
      return (
        <Badge variant="success" title="Accepted by the governance contract in an eth_call">
          <CheckCircle2 /> Verified {source ? `· ${SOURCE_LABEL[source]}` : ""}
        </Badge>
      );
    case "collecting":
      return (
        <Badge variant="warning" title="The Safe message does not have enough owner signatures yet">
          <CircleDashed /> Collecting · {confirmations ?? 0} of {safeThreshold ?? "?"} owners
        </Badge>
      );
    case "invalid":
      return (
        <Badge variant="error" title="The governance contract rejected this signature">
          <XCircle /> Rejected
        </Badge>
      );
    case "unavailable":
      return <Badge variant="warning">Safe API unavailable</Badge>;
    default:
      return <Badge variant="neutral">Not signed</Badge>;
  }
}
