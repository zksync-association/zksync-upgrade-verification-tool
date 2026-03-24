/**
 * Shown on the freeze / emergency-upgrade proposal pages when a front-run is
 * detected: the user's transaction failed but the ProtocolUpgradeHandler
 * already shows the freeze (or unfreeze) as having occurred, meaning a
 * different party executed the action first.
 */

import { AlertTriangle } from "lucide-react";
import { Link } from "@remix-run/react";
import { Button } from "@/components/ui/button";

type Props = {
  /** "freeze" when a freeze tx failed but protocol is frozen.
   *  "unfreeze" when a freeze tx failed after an emergency upgrade cleared it. */
  type: "freeze" | "unfreeze";
  /** Number of hyperchains that still need reinforcement, if known. */
  unreinforcedChains?: number;
};

export function FrontRunWarningBanner({ type, unreinforcedChains }: Props) {
  const title =
    type === "freeze"
      ? "⚠ Front-Run Detected: Your freeze transaction may have failed, but the protocol is already frozen."
      : "⚠ Front-Run Detected: Your unfreeze/emergency-upgrade transaction may have failed, but the protocol is already unfrozen.";

  const body =
    type === "freeze"
      ? "Someone may have submitted a freeze transaction before yours. The ProtocolUpgradeHandler registers the protocol as frozen. However, individual hyperchains and bridges may not yet have been frozen — especially if _freeze() has its multi-chain logic commented out (TODO pending full L2 deployment)."
      : "The protocol appears to have been unfrozen (or an emergency upgrade executed) before your transaction. Hyperchains may not yet be unfrozen.";

  const chainNote =
    unreinforcedChains !== undefined && unreinforcedChains > 0
      ? ` ${unreinforcedChains} hyperchain(s) still need reinforcement.`
      : "";

  return (
    <div
      className="flex items-start gap-3 rounded-lg border-2 border-red-500 bg-red-950/60 p-4 text-red-200"
      data-testid="front-run-warning-banner"
    >
      <AlertTriangle className="mt-0.5 h-8 w-8 shrink-0 text-red-400" />
      <div className="flex-1 space-y-2">
        <p className="font-bold text-red-300 text-base">{title}</p>
        <p className="text-sm">{body}{chainNote}</p>
        <p className="text-sm">
          Please proceed to the{" "}
          <Link to="/app/reinforce" className="underline hover:text-red-100">
            Reinforce Freeze / Unfreeze page
          </Link>{" "}
          to ensure all hyperchains and bridges are in the correct state.
        </p>
        <Link to="/app/reinforce">
          <Button variant="destructive" size="sm" className="mt-2">
            Go to Reinforce Page →
          </Button>
        </Link>
      </div>
    </div>
  );
}
