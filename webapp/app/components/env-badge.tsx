import { Badge } from "@/components/ui/badge";
import type { NodeEnv } from "@config/env.server";

export default function EnvBadge({ environment }: { environment: NodeEnv }) {
  if (environment === "production") {
    return null;
  }
  return (
    <Badge variant={"outline"} className="h-auto px-3 py-1 text-s">
      {environment.charAt(0).toUpperCase() + environment.slice(1, 3)}
    </Badge>
  );
}
