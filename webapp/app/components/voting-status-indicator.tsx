import { Progress } from "@/components/ui/progress";
import { cn } from "@/utils/cn";

export default function VotingStatusIndicator({
  signatures,
  necessarySignatures,
  label,
  className,
  testId
}: { signatures: number; necessarySignatures: number; label: string; className?: string, testId?: string }) {
  const necessarySignaturesReached = signatures >= necessarySignatures;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex justify-between">
        <span>{label}</span>
        <span
          className={cn("text-muted-foreground", necessarySignaturesReached && "text-green-400")}
          data-testid={testId}
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
