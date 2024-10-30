import { getL2CancellationById, updateL2Cancellation } from "@/.server/db/dto/l2-cancellations";
import { l2CancellationStatusEnum } from "@/.server/db/schema";
import { notFound } from "@/utils/http";
import { type ActionFunctionArgs, redirect } from "@remix-run/node";
import { hexSchema } from "@repo/common/schemas";
import { $path } from "remix-routes";
import { z } from "zod";
import { getFormDataOrThrow, extractFromParams } from "@/utils/read-from-request";

export async function action({ request, params: remixParams }: ActionFunctionArgs) {
  const { id } = extractFromParams(remixParams, z.object({ id: z.coerce.number() }), notFound());

  const { hash } = await getFormDataOrThrow(request, {
    hash: hexSchema,
  });

  const proposal = await getL2CancellationById(id);
  if (!proposal) {
    throw notFound();
  }

  await updateL2Cancellation({
    id: proposal.id,
    transactionHash: hash,
    status: l2CancellationStatusEnum.enum.DONE,
  });

  return redirect($path("/app/transactions/:hash", { hash }));
}
