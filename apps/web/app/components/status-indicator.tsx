import type { UserRole } from "@/common/user-role-schema";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/utils/cn";

export function StatusIndicator({
  signatures,
  necessarySignatures,
  role,
}: { signatures: number; necessarySignatures: number; role: UserRoleWithSignatures }) {
  const necessarySignaturesReached = signatures >= necessarySignatures;

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <span>{Label[role]}</span>
        <span
          className={cn("text-muted-foreground", necessarySignaturesReached && "text-green-400")}
          data-testid={DataTestId[role]}
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

type UserRoleWithSignatures = Exclude<UserRole, "visitor" | "zkAdmin">;

const Label = {
  securityCouncil: "Security Council Approvals",
  guardian: "Guardian Approvals",
  zkFoundation: "ZKsync Foundation Approval",
} satisfies Record<UserRoleWithSignatures, string>;

const DataTestId = {
  securityCouncil: "security-signatures",
  guardian: "guardian-signatures",
  zkFoundation: "zkfoundation-signatures",
} satisfies Record<UserRoleWithSignatures, string>;
