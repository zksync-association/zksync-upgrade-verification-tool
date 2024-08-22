import { getFreezeProposalById, updateFreezeProposal } from "@/.server/db/dto/freeze-proposals";
import { hexSchema } from "@/common/basic-schemas";
import { notFound } from "@/utils/http";
import { type ActionFunctionArgs, redirect } from "@remix-run/node";
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
  //
  // const freezeProposal = await getFreezeProposalById(params.data.id);
  // if (!freezeProposal) {
  //   throw notFound();
  // }
  //
  // await updateFreezeProposal(freezeProposal.id, {
  //   transactionHash: data.data.hash,
  // });
  return redirect($path("/app/transactions/:hash", { hash: data.data.hash }));
}
