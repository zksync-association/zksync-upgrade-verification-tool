import { decodeAbiParameters, getAbiItem, type Hex, numberToHex } from "viem";
import { ALL_ABIS } from "@/utils/raw-abis";
import { UpgradeRawData } from "@/components/upgrade-raw-data";

export function RawStandardUpgrade(props: { encoded: Hex }) {
  const abiItem = getAbiItem({
    abi: ALL_ABIS.handler,
    name: "execute",
  });

  const [upgradeProposal] = decodeAbiParameters([abiItem.inputs[0]], props.encoded);

  const calls = upgradeProposal.calls.map((call) => ({ ...call, value: numberToHex(call.value) }));
  return <UpgradeRawData calls={calls} salt={upgradeProposal.salt} />;
}
