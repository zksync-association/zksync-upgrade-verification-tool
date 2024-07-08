import msl from "@/images/msl.svg";
import { cn } from "@/utils/cn";

export default function Loading({ className }: { className?: string }) {
  return <img src={msl} alt="loading" className={cn("h-10 w-10 animate-spin-slow", className)} />;
}
