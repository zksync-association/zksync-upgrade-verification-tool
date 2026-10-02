import { getFreezeRequest } from "@/.server/flows/freeze";
import { parseFreezeParams } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { respond } from "@/.server/api";

export const loader = ({ params, request }: LoaderFunctionArgs) =>
  respond(() =>
    getFreezeRequest(parseFreezeParams(params.action, new URL(request.url)), {
      supplied: suppliedSignatures(request),
    })
  );
