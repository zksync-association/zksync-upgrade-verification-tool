import { watchItems, watchKeys } from "@/.server/sync/presence";
import { notStartedUpgrades } from "@/.server/flows/l2";
import { network } from "@/.server/rpc";
import { simulate } from "@/.server/signatures";
import { upgradeHandlerAbi } from "@/common/abis";
import { decodeUpgradeProposal, upgradeProposalId } from "@/common/proposal";
import { TxLink } from "@/components/hex";
import { EmptyState, LoadingCard, PageHeader } from "@/components/page";
import { Card } from "@/components/ui/card";
import { ExecutionPanel } from "@/components/verification/execution-panel";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, defer } from "@remix-run/node";
import { Await, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";
import { $path } from "remix-routes";
import { encodeFunctionData, hexToBigInt, hexToNumber } from "viem";

export const meta = Meta["/app/proposals/new"];

// Executed ZkProtocolGovernor proposals (last 30 days on ZKsync Era) whose L1 upgrade has not
// been started yet, with the startUpgrade transaction ready to send. Anyone can start an upgrade.
async function startable() {
  const { upgradeHandler } = await network();
  const items = await notStartedUpgrades();
  return Promise.all(
    items.map(async (item) => {
      if (!item.ok) return { ...item, execution: null, idMatches: null };
      const proposal = decodeUpgradeProposal(item.data.proposal);
      const data = encodeFunctionData({
        abi: upgradeHandlerAbi,
        functionName: "startUpgrade",
        args: [
          hexToBigInt(item.data.l2BatchNumber),
          hexToBigInt(item.data.l2MessageIndex),
          item.data.l2TxNumberInBatch ? hexToNumber(item.data.l2TxNumberInBatch) : 0,
          item.data.proof,
          {
            calls: proposal.calls.map((c) => ({
              target: c.target,
              value: BigInt(c.value),
              data: c.data,
            })),
            executor: proposal.executor,
            salt: proposal.salt,
          },
        ],
      });
      const execution = { to: upgradeHandler, data, value: "0", functionName: "startUpgrade" };
      return {
        ...item,
        idMatches: upgradeProposalId(proposal) === item.l1ProposalId,
        execution: { ...execution, simulation: await simulate(execution) },
      };
    })
  );
}

export function loader({ request }: LoaderFunctionArgs) {
  return defer({ watch: watchItems(request, [watchKeys.startable]), items: startable() });
}

export default function StartUpgrade() {
  const { items } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-8">
      <PageHeader
        back={{ to: $path("/app/proposals"), label: "Upgrades" }}
        eyebrow="Standard governance"
        title="Start an upgrade from L2"
      >
        <p className="max-w-3xl text-slate-950">
          Once a ZkProtocolGovernor proposal is executed on ZKsync Era and its batch is final on L1,
          anyone can start the upgrade on L1 by proving the L2 → L1 message. Starting it begins the
          legal veto period.
        </p>
      </PageHeader>
      <Suspense fallback={<LoadingCard label="Looking for executed L2 protocol proposals…" />}>
        <Await resolve={items}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>No executed L2 protocol proposal is waiting to be started.</EmptyState>
            ) : (
              <div className="space-y-4">
                {list.map((item) => (
                  <Card key={item.l2ProposalId} className="space-y-3 p-6">
                    <p className="font-medium text-slate-950">
                      L2 proposal{" "}
                      <span className="mono">{BigInt(item.l2ProposalId).toString()}</span>
                    </p>
                    <p className="text-slate-600 text-sm">
                      Executed on ZKsync Era in <TxLink hash={item.executedTx} l2 />
                      {item.ok && (
                        <>
                          {" "}
                          · L1 upgrade id <span className="mono">{item.l1ProposalId}</span>
                        </>
                      )}
                    </p>
                    {item.ok && item.execution ? (
                      <ExecutionPanel
                        execution={item.execution}
                        toLabel="ProtocolUpgradeHandler"
                        title="Start the upgrade"
                      />
                    ) : (
                      <p className="text-amber-800 text-sm">
                        {"error" in item ? item.error : "Not ready"}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            )
          }
        </Await>
      </Suspense>
    </div>
  );
}
