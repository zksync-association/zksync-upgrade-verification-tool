import { cn } from "@/utils/cn";
import type { Step1 } from "./step1";

export default function DisplayStep1({ title, salt, className }: Step1 & { className?: string }) {
  return (
    <div className={cn("grid grid-cols-[70px_1fr] rounded-xl bg-muted p-4", className)}>
      <span className="font-medium text-muted-foreground text-sm">Title:</span>{" "}
      <span className="break-words text-sm">{title}</span>
      <span className="font-medium text-muted-foreground text-sm">Salt:</span>{" "}
      <span className="break-all text-sm">{salt}</span>
    </div>
  );
}
