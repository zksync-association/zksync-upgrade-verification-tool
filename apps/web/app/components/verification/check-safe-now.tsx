import { useSafeCheck } from "@/components/presence";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function CheckSafeNow({ watchKey }: { watchKey: string }) {
  const check = useSafeCheck(watchKey);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {check.error && (
        <span className="text-amber-900 text-xs" role="status">
          Could not check: {check.error}
        </span>
      )}
      {!check.error && check.failed > 0 && (
        <span className="text-amber-900 text-xs" role="status">
          Safe did not answer for {check.failed} member{check.failed === 1 ? "" : "s"}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => void check.run()}
        loading={check.running}
        disabled={check.running}
        title="Read the members' Safe messages now"
        data-testid="check-safe-now"
      >
        {!check.running && <RefreshCw />}
        {check.running ? "Checking Safe…" : "Check Safe now"}
      </Button>
    </span>
  );
}
