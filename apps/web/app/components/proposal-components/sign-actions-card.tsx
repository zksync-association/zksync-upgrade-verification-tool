import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import type { UserRole } from "@/common/user-role-schema";

const Title = {
  securityCouncil: "Security Council Actions",
  zkAdmin: "ZK Admin Actions",
  guardian: "Guardian Actions",
  zkFoundation: "ZK Foundation Actions",
  visitor: "Visitor Actions",
} satisfies Record<UserRole, string>;

export default function SignActionsCard({
  children,
  role,
  enabledRoles,
}: { children: ReactNode; role: UserRole; enabledRoles: UserRole[] }) {
  const isEnabled = enabledRoles.includes(role);

  if (!isEnabled) {
    return (
      <Layout title={Title[role]}>
        <div className="flex flex-1 items-center justify-center text-gray-500">
          No actions available for this role.
        </div>
      </Layout>
    );
  }

  return <Layout title={Title[role]}>{children}</Layout>;
}

function Layout({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Card data-testid="role-actions-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col space-y-3">{children}</CardContent>
    </Card>
  );
}
