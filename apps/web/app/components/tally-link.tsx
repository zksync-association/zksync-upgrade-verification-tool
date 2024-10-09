import { SquareArrowOutUpRight } from "lucide-react";
import { hexToBigInt, type Hex } from "viem";

export default function TallyLink({
  l2ProposalId,
  baseUrl,
}: {
  l2ProposalId: Hex;
  baseUrl: string;
}) {
  return (
    <a
      href={getTallyUrl(baseUrl, l2ProposalId)}
      className="flex items-center justify-end break-words underline"
      target="_blank"
      rel="noreferrer"
    >
      <span>{formatTallyId(l2ProposalId)}</span>
      <SquareArrowOutUpRight
        className="ml-1"
        width={12}
        height={12}
        data-testid="square-arrow-out-up-right-icon"
      />
    </a>
  );
}

function formatTallyId(proposalId: Hex) {
  const id = hexToBigInt(proposalId).toString();
  return `${id.slice(0, 6)}...${id.slice(-6)}`;
}

function getTallyUrl(baseUrl: string, l2ProposalId: Hex) {
  return `${baseUrl}/proposal/${hexToBigInt(l2ProposalId).toString()}`;
}
