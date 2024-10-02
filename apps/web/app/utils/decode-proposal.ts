import { decodeAbiParameters, getAbiItem, type Hex, numberToHex } from "viem";
import { upgradeHandlerAbi } from "@/utils/contract-abis";

export function decodeProposal(proposalCalldata: Hex) {
  const abiItem = getAbiItem({
    abi: upgradeHandlerAbi,
    name: "execute",
  });

  const [upgradeProposal] = decodeAbiParameters([abiItem.inputs[0]], proposalCalldata);
  return upgradeProposal;
}

export function decodeProposalSerializable(proposalCalldata: Hex) {
  const decoded = decodeProposal(proposalCalldata);
  return {
    ...decodeProposal,
    calls: decoded.calls.map((c) => ({ ...c, value: numberToHex(c.value) })),
  };
}
