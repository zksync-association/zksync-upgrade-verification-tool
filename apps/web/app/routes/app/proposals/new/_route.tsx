import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { searchNotStartedProposals } from "@/.server/service/proposals";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { StartUpgradeButton } from "@/routes/app/proposals/new/start-upgrade-button";
import { useState } from "react";
import type { StartUpgradeData } from "@/common/types";
import { env } from "@config/env.server";

export async function loader() {
  const proposals = await searchNotStartedProposals();
  return json({
    proposals,
    target: env.UPGRADE_HANDLER_ADDRESS
  });
}

export default function startProposal() {
  const { proposals, target } = useLoaderData<typeof loader>();
  const [upgradeData, setUpgradeData] = useState<StartUpgradeData | null>(null);

  return (
    <div>
      <h2 className="font-semibold text-2xl leading-none tracking-tight">Start regular upgrade flow</h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Id</TableHead>
            <TableHead>Error</TableHead>
            <TableHead/>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposals.map(proposal => (
            <TableRow key={proposal.l2ProposalId}>
              <TableCell>{proposal.l2ProposalId}</TableCell>
              <TableCell>{proposal.error ?? "-"}</TableCell>
              {proposal.ok && (
                <TableCell>
                  <Input type={"radio"} name={"proposal"} value={proposal.l2ProposalId} onClick={() => setUpgradeData(proposal.data)}/>
                </TableCell>
              )}
              {!proposal.ok && (
                <TableCell>
                </TableCell>
              )}

            </TableRow>
          ))}
        </TableBody>
      </Table>
      <StartUpgradeButton target={target} data={upgradeData}/>
    </div>
  );
}
