import { formatEther, hexToBigInt } from "viem";
import { Trash2 } from "lucide-react";
import type { Call } from "@/common/calls";

type DisplayCallProps = {
  calls: Call[],
  removeCall?: (i: number) => void
};

export function DisplayCalls({calls, removeCall}: DisplayCallProps) {
  return (
    <div className="grid grid-cols-3 gap-x-4 pb-10">
      {calls.map((call, i) => (
        <div key={call.target + call.data + call.value} className="rounded-md bg-muted p-4 flex align-middle">
          <div className="grid grid-cols-4">
            <div className="font-medium text-muted-foreground text-sm col-span-1">
              target:
            </div>
            <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
              {call.target}
            </div>

            <div className="font-medium text-muted-foreground text-sm col-span-1">
              data:
            </div>
            <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
              {call.data}
            </div>

            <div className="font-medium text-muted-foreground text-sm col-span-1">
              value:
            </div>
            <div className="col-span-3 overflow-x-hidden overflow-ellipsis font-mono">
              {formatEther(hexToBigInt(call.value))}
            </div>
          </div>
          {removeCall &&
            <div className="px-3">
              <div className="aspect-square border-2 rounded-md p-1 cursor-pointer" onClick={() => removeCall(i)}>
                <Trash2 size={15}/>
              </div>
            </div>
          }
        </div>
      ))}
    </div>
  )
}