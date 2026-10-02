import { getStandardUpgrade } from "@/.server/flows/standard";
import { parseId } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { respond } from "@/.server/api";

export const loader = ({ params, request }: LoaderFunctionArgs) =>
  respond(() => getStandardUpgrade(parseId(params.id), { supplied: suppliedSignatures(request) }));
