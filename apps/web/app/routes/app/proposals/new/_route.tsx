import { type ActionFunctionArgs, json } from "@remix-run/node";
import { redirect, useLoaderData } from "@remix-run/react";
import { searchNotStartedProposals } from "@/.server/service/proposals";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { StartUpgradeButton } from "@/routes/app/proposals/new/start-upgrade-button";
import { useState } from "react";
import type { StartUpgradeData } from "@/common/types";
import { env } from "@config/env.server";
import { parseFormData } from "@/utils/read-from-request";
import { hexSchema } from "@repo/common/schemas";
import { badRequest } from "@/utils/http";
import { $path } from "remix-routes";
import { hexToBigInt } from "viem";
import { displayBytes32 } from "@/utils/common-tables";

export async function loader() {
  const proposals = await searchNotStartedProposals();
  return json({
    proposals,
    target: env.UPGRADE_HANDLER_ADDRESS,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const parsed = parseFormData(await request.formData(), { txHash: hexSchema });
  if (!parsed.success) {
    throw badRequest("Failed to parse body");
  }
  return redirect($path("/app/transactions/:hash", { hash: parsed.data.txHash }));
}

export default function startProposal() {
  const { proposals, target } = useLoaderData<typeof loader>();
  const [upgradeData, setUpgradeData] = useState<StartUpgradeData | null>(null);

  return (
    <div>
      <h2 className="font-semibold text-2xl leading-none tracking-tight">
        Start regular upgrade flow
      </h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tally id</TableHead>
            <TableHead>L1 id</TableHead>
            <TableHead>Error</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposals.map((proposal) => (
            <TableRow key={proposal.l2ProposalId}>
              <TableCell>{hexToBigInt(proposal.l2ProposalId).toString(10)}</TableCell>
              <TableCell>
                {proposal.l1ProposalId ? displayBytes32(proposal.l1ProposalId) : "-"}
              </TableCell>
              <TableCell>{proposal.error ?? "-"}</TableCell>
              {proposal.ok && (
                <TableCell>
                  <Input
                    type={"radio"}
                    name={"proposal"}
                    value={proposal.l2ProposalId}
                    onClick={() => setUpgradeData(proposal.data)}
                  />
                </TableCell>
              )}
              {!proposal.ok && <TableCell />}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <StartUpgradeButton target={target} data={upgradeData} />
    </div>
  );
}
