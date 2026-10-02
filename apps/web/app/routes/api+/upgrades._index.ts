import { listStandardUpgrades } from "@/.server/flows/standard";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { respond } from "@/.server/api";

export const loader = ({ request }: LoaderFunctionArgs) =>
  respond(() =>
    listStandardUpgrades({ allHistory: new URL(request.url).searchParams.get("history") === "all" })
  );
