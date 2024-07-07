import { cn } from "@/utils/cn";
import { CircleUserRound } from "lucide-react";

export default function Avatar({
  ensImage,
  size,
  className,
}: { address: string; ensImage?: string | null; size: number; className?: string }) {
  if (!ensImage) {
    return <CircleUserRound className={className} width={size} height={size} />;
  }
  return (
    <img
      src={ensImage}
      alt="Avatar"
      className={cn("rounded-full", className)}
      style={{ height: size, width: size }}
    />
  );
}
