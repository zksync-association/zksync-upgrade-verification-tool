import type { UpgradeProposal } from "@/common/proposal";
import { CopyButton } from "@/components/hex";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { numberToHex } from "viem";

/** The proposal in the CLI's upgrade-file format (apps/cli `validate … -f upgrade.json`). */
export function upgradeFileJson(proposal: UpgradeProposal) {
  return JSON.stringify(
    {
      calls: proposal.calls.map((c) => ({
        target: c.target,
        value: numberToHex(BigInt(c.value)),
        data: c.data,
      })),
      executor: proposal.executor,
      salt: proposal.salt,
    },
    null,
    2
  );
}

export function UpgradeFile({ proposal, name }: { proposal: UpgradeProposal; name: string }) {
  const json = upgradeFileJson(proposal);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
      <p className="text-slate-950">
        Check it in depth with the CLI:{" "}
        <span className="mono text-slate-700">
          pnpm validate check -f {name}.json --ref=&lt;commit&gt;
        </span>
      </p>
      <div className="flex items-center gap-1">
        <CopyButton value={json} label="Copy upgrade file" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
            a.download = `${name}.json`;
            a.click();
          }}
        >
          <Download /> Upgrade file
        </Button>
      </div>
    </div>
  );
}
