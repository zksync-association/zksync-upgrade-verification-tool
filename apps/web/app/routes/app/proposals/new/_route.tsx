import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { searchNotStartedProposals } from "@/.server/service/proposals";

export async function loader() {
  return json(await searchNotStartedProposals())
}

export default function startProposal() {
  const proposals = useLoaderData<typeof loader>()
  return (
    <div>{JSON.stringify(proposals, null, 2)}</div>
  )
}