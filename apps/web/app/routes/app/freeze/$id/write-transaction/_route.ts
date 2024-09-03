import { getFreezeProposalById, updateFreezeProposal } from "@/.server/db/dto/freeze-proposals";
import { notFound } from "@/utils/http";
import { type ActionFunctionArgs, redirect } from "@remix-run/node";
import { hexSchema } from "@repo/common/schemas";
import { getParams } from "remix-params-helper";
import { $path } from "remix-routes";
import { z } from "zod";
import { extractFromFormData } from "@/utils/extract-from-formdata";

export async function action({ request, params: remixParams }: ActionFunctionArgs) {
  const params = getParams(remixParams, z.object({ id: z.coerce.number() }));
  if (!params.success) {
    throw notFound();
  }

  const { hash } = await extractFromFormData(
    request,
    z.object({
      hash: hexSchema,
    }),
    notFound()
  );

  const freezeProposal = await getFreezeProposalById(params.data.id);
  if (!freezeProposal) {
    throw notFound();
  }

  await updateFreezeProposal(freezeProposal.id, {
    transactionHash: hash,
  });
  return redirect($path("/app/transactions/:hash", { hash }));
}
