import { getL2CancellationById, updateL2Cancellation } from "@/.server/db/dto/l2-cancellations";
import { l2CancellationStatusEnum } from "@/.server/db/schema";
import { notFound } from "@/utils/http";
import { type ActionFunctionArgs, redirect } from "@remix-run/node";
import { hexSchema } from "@repo/common/schemas";
import { getFormData, getParams } from "remix-params-helper";
import { $path } from "remix-routes";
import { z } from "zod";

export async function action({ request, params: remixParams }: ActionFunctionArgs) {
  const params = getParams(remixParams, z.object({ id: z.coerce.number() }));
  if (!params.success) {
    throw notFound();
  }

  const data = await getFormData(
    request,
    z.object({
      hash: hexSchema,
    })
  );
  if (!data.success) {
    throw notFound();
  }

  const proposal = await getL2CancellationById(params.data.id);
  if (!proposal) {
    throw notFound();
  }

  await updateL2Cancellation(proposal.id, {
    transactionHash: data.data.hash,
    status: l2CancellationStatusEnum.enum.DONE,
  });

  return redirect($path("/app/transactions/:hash", { hash: data.data.hash }));
}
