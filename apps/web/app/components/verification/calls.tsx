import type { DecodedCall } from "@/common/proposal";
import { AddressLink, CopyButton } from "@/components/hex";
import { cn } from "@/utils/cn";
import { formatEth } from "@/utils/format";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

export function CallList({
  calls,
  labels,
}: { calls: DecodedCall[]; labels?: Record<string, string> }) {
  return (
    <ol className="space-y-3" data-testid="call-list">
      {calls.map((call, i) => (
        <CallItem
          key={`${i}-${call.target}`}
          index={i}
          call={call}
          label={labels?.[call.target.toLowerCase()]}
        />
      ))}
    </ol>
  );
}

function CallItem({ call, index, label }: { call: DecodedCall; index: number; label?: string }) {
  const [raw, setRaw] = useState(false);
  return (
    <li className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-75 font-medium text-[12px] text-navy-800">
          {index + 1}
        </span>
        <AddressLink address={call.target} label={label} />
        <span className="text-slate-600 text-sm">value {formatEth(call.value)}</span>
      </div>
      <div className="space-y-2 px-4 py-3 text-sm">
        {call.decoded ? (
          <div>
            <p className="mono font-medium text-slate-950">{call.decoded.signature}</p>
            <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-[180px_1fr]">
              {call.decoded.args.map((arg) => (
                <div key={arg.name} className="contents">
                  <dt className="mono text-slate-600">
                    {arg.name} <span className="text-slate-400">{arg.type}</span>
                  </dt>
                  <dd className="mono break-all text-slate-950">{arg.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 text-slate-600 text-xs">
              Decoded with a known signature and re-encoded to the exact calldata.
            </p>
          </div>
        ) : (
          <p className="text-slate-950">
            {call.selector ? (
              <>
                Selector <span className="mono">{call.selector}</span>: not one of the functions
                this app decodes. Check it with the CLI (<span className="mono">apps/cli</span>) or
                a block explorer.
              </>
            ) : (
              "No calldata (plain value transfer)."
            )}
          </p>
        )}
        <button
          type="button"
          onClick={() => setRaw(!raw)}
          className="inline-flex items-center gap-1 text-slate-600 text-xs hover:text-slate-950"
          aria-expanded={raw}
        >
          Raw calldata ({(call.data.length - 2) / 2} bytes)
          <ChevronDown className={cn("h-3 w-3 transition-transform", raw && "rotate-180")} />
        </button>
        {raw && (
          <div className="relative">
            <pre className="mono max-h-56 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 pr-9">
              {call.data}
            </pre>
            <CopyButton value={call.data} className="absolute top-2 right-2" />
          </div>
        )}
      </div>
    </li>
  );
}
