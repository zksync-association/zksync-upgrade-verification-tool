import { displayBytes32 } from "@/utils/common-tables";
import { SquareArrowOutUpRight } from "lucide-react";
import type { Hex } from "viem";

export default function TxLink({ hash, url }: { hash: Hex; url: string }) {
  return (
    <a
      href={url}
      className="flex items-center justify-end break-words underline"
      target="_blank"
      rel="noreferrer"
    >
      <span>{displayBytes32(hash)}</span>
      <SquareArrowOutUpRight
        className="ml-1"
        width={12}
        height={12}
        data-testid="square-arrow-out-up-right-icon"
      />
    </a>
  );
}
