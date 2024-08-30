import { Badge } from "@/components/ui/badge";
import type { loader } from "@/root";
import { useRouteLoaderData } from "@remix-run/react";

export default function EnvBadge() {
  const data = useRouteLoaderData<typeof loader>("root");

  const env = data?.env.NODE_ENV;
  if (!env) {
    throw new Error("NODE_ENV is not defined");
  }

  if (env === "production") {
    return null;
  }
  return (
    <Badge variant={"outline"} className="h-auto px-3 py-1 text-s">
      {env.charAt(0).toUpperCase() + env.slice(1, 3)}
    </Badge>
  );
}
