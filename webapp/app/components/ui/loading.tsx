import msl from "@/images/msl.svg";
import { cn } from "@/utils/cn";

export default function Loading({ className }: { className?: string }) {
  return <img src={msl} alt="loading" className={cn("w-10 h-10 animate-spin-slow", className)} />;
}
