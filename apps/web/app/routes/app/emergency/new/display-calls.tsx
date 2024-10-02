import type { Call } from "@/common/calls";
import { Trash2 } from "lucide-react";
import { formatEther, hexToBigInt } from "viem";

type DisplayCallProps = {
  calls: Call[];
  removeCall?: (i: number) => void;
};

export function DisplayCalls({ calls, removeCall }: DisplayCallProps) {
  return (
    <div className="grid grid-cols-3 gap-x-4 pb-10">
      {calls.map((call, i) => (
        <div
          key={call.target + call.data + call.value}
          className="flex rounded-md bg-muted p-4 align-middle"
        >
          <div className="grid grid-cols-4">
            <div className="col-span-1 font-medium text-muted-foreground text-sm">Target:</div>
            <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
              {call.target}
            </div>

            <div className="col-span-1 font-medium text-muted-foreground text-sm">Data:</div>
            <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
              {call.data}
            </div>

            <div className="col-span-1 font-medium text-muted-foreground text-sm">Value:</div>
            <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
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
