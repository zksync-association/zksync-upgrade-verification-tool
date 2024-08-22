import { cn } from "@/utils/cn";
import { CircleCheck, CircleX, Clock } from "lucide-react";
import type { Hex } from "viem";
import { useWaitForTransactionReceipt } from "wagmi";
import { Badge } from "./ui/badge";
import type Loading from "./ui/loading";

export default function TxStatus({ hash, className }: { hash: Hex; className?: string }) {
  const tx = useWaitForTransactionReceipt({ hash });

  let text: string;
  let Icon: typeof CircleCheck | typeof Loading;
  let badgeClassname: string;

  if (tx.data) {
    if (tx.data.status === "success") {
      text = "Success";
      Icon = CircleCheck;
      badgeClassname = "bg-green-600 hover:bg-green-700";
    } else {
      text = "Failed";
      Icon = CircleX;
      badgeClassname = "bg-red-600 hover:bg-red-700";
    }
  } else if (tx.isLoading) {
    text = "Loading";
    Icon = Clock;
    badgeClassname = "bg-gray-600 hover:bg-gray-700";
  } else {
    text = "Processing";
    Icon = Clock;
    badgeClassname = "bg-yellow-600 hover:bg-yellow-700";
  }

  return (
    <Badge className={cn("flex justify-center bg-green-600", badgeClassname, className)}>
      <Icon className="mr-1 h-4 w-4" /> {text}
    </Badge>
  );
}
