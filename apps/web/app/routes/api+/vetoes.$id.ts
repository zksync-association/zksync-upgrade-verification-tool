import { getL2Veto } from "@/.server/flows/l2-veto";
import { parseVetoParams } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { respond } from "@/.server/api";

export const loader = ({ params, request }: LoaderFunctionArgs) =>
  respond(() =>
    getL2Veto(parseVetoParams(params.id, new URL(request.url)), {
      supplied: suppliedSignatures(request),
    })
  );
