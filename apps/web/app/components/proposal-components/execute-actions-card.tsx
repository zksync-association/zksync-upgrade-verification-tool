import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export default function ExecuteActionsCard({ children }: { children: ReactNode }) {
  return (
    <Card data-testid="execute-actions-card">
      <CardHeader>
        <CardTitle>Execute Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col space-y-3">{children}</CardContent>
    </Card>
  );
}
