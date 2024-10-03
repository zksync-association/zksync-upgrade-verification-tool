import type { Call } from "@/common/calls";
import { cn } from "@/utils/cn";
import { Trash2 } from "lucide-react";
import { formatEther, hexToBigInt } from "viem";

type DisplayCallProps = {
  calls: Call[];
  removeCall?: (i: number) => void;
};

export default function DisplayStep2({
  calls,
  removeCall,
  className,
}: DisplayCallProps & { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {calls.map((call, i) => (
        <div
          key={call.target + call.data + call.value}
          className="flex rounded-xl bg-muted p-4 align-middle"
        >
          <div className="grid grid-cols-[70px_1fr]">
            <div className="font-medium text-muted-foreground text-sm">Target:</div>
            <div className="overflow-x-hidden overflow-ellipsis font-mono text-sm">
              {call.target}
            </div>

            <div className="font-medium text-muted-foreground text-sm">Calldata:</div>
            <div className="overflow-x-hidden overflow-ellipsis font-mono text-sm">{call.data}</div>

            <div className="font-medium text-muted-foreground text-sm">Value:</div>
            <div className="overflow-x-hidden overflow-ellipsis font-mono text-sm">
              {formatEther(hexToBigInt(call.value))}
            </div>
          </div>
          {removeCall && (
            <div className="px-3">
              <button
                type="button"
                className="aspect-square cursor-pointer rounded-md border-2 p-1"
                onClick={() => removeCall(i)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
