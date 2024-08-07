import { Progress } from "@/components/ui/progress";
import { cn } from "@/utils/cn";

export default function VotingStatusIndicator({
  signatures,
  necessarySignatures,
  label,
}: { signatures: number; necessarySignatures: number; label: string }) {
  const necessarySignaturesReached = signatures >= necessarySignatures;

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <span>{label}</span>
        <span
          className={cn("text-muted-foreground", necessarySignaturesReached && "text-green-400")}
        >
          {signatures}/{necessarySignatures}
        </span>
      </div>
      <Progress
        indicatorClassName={cn(necessarySignaturesReached && "bg-green-500")}
        value={(signatures / necessarySignatures) * 100}
      />
    </div>
  );
}
