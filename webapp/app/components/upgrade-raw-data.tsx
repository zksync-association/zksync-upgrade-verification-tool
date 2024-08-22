import type { Call } from "@/common/calls";
import { formatEther, hexToBigInt } from "viem";

type UpgradeRawDataProps = { calls: Call[]; salt: string };

export function CallsRawData({ calls }: { calls: Call[] }) {
  return (
    <div>
      <h3 className="font-bold text-xl">Calls</h3>

      {calls.map((call) => (
        <div
          key={call.target + call.target + call.value}
          className="mt-10 grid grid-cols-4 gap-y-3 border-t-2 pt-5"
        >
          <div className="grid-col-span-1">Target</div>
          <div className="col-span-3 font-mono">
            <span className="break-words">{call.target}</span>
          </div>

          <div className="grid-col-span-1">Data</div>
          <div className="col-span-3 font-mono">
            <span className="break-words">{call.data}</span>
          </div>

          <div className="grid-col-span-1">Value</div>
          <div className="col-span-3 font-mono">
            <span className="break-words">{formatEther(hexToBigInt(call.value))}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function UpgradeRawData({calls, salt }: UpgradeRawDataProps) {
  return (
    <div>
      <p className="pb-10">
        <b>salt:</b> <span>{salt}</span>
      </p>

      <CallsRawData calls={calls} />
    </div>
  );
}
