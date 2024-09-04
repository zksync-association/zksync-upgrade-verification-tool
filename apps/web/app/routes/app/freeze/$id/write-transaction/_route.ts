import { getFreezeProposalById, updateFreezeProposal } from "@/.server/db/dto/freeze-proposals";
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

  const freezeProposal = await getFreezeProposalById(id);
  if (!freezeProposal) {
    throw notFound();
  }

  await updateFreezeProposal(freezeProposal.id, {
    transactionHash: hash,
  });
  return redirect($path("/app/transactions/:hash", { hash }));
}
