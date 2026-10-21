import { watchItems, watchKeys } from "@/.server/sync/presence";
import {
  type NotStartedUpgrade,
  l2ProposalTitle,
  l2TxTime,
  notStartedUpgrades,
} from "@/.server/flows/l2";
import { network } from "@/.server/rpc";
import { loaderRevs, startableContent } from "@/.server/sync/content";
import { simulate } from "@/.server/signatures";
import { upgradeHandlerAbi } from "@/common/abis";
import { decodeUpgradeProposal, upgradeProposalId } from "@/common/proposal";
import { MAX_STARTABLE_DAYS, startableDays } from "@/common/startable";
import { TxLink } from "@/components/hex";
import { EmptyState, LoadingCard, PageHeader, QuietEmpty } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ExecutionPanel } from "@/components/verification/execution-panel";
import { formatDay } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, defer } from "@remix-run/node";
import { Await, Form, useLoaderData, useNavigation } from "@remix-run/react";
import { Suspense } from "react";
import { $path } from "remix-routes";
import { encodeFunctionData, hexToBigInt, hexToNumber } from "viem";

export const meta = Meta["/app/proposals/new"];

// Executed ZkProtocolGovernor proposals (last 30 days on ZKsync Era) whose L1 upgrade has not
// been started yet, with the startUpgrade transaction ready to send. Anyone can start an upgrade.
// Read at the Era head pages read (the Era timer's, at most a minute old), and the simulation at
// the L1 head (kept for it).
async function startable(found: Promise<NotStartedUpgrade[]>) {
  const { upgradeHandler, l2Governors } = await network();
  const items = await found;
  return Promise.all(
    items.map(async (item) => {
      // Its name and when it executed on Era, for the card: neither decides anything.
      const [title, executedAt] = await Promise.all([
        l2Governors.protocol
          ? l2ProposalTitle(l2Governors.protocol, BigInt(item.l2ProposalId), { page: true }).catch(
              () => null
            )
          : null,
        l2TxTime(item.executedTx).catch(() => null),
      ]);
      const about = { title, executedAt };
      if (!item.ok) return { ...item, ...about, execution: null, idMatches: null };
      let proposal: ReturnType<typeof decodeUpgradeProposal>;
      try {
        proposal = decodeUpgradeProposal(item.data.proposal);
      } catch {
        // Its message is something else (seen in December 2024): nothing to start from it.
        return {
          l2ProposalId: item.l2ProposalId,
          executedTx: item.executedTx,
          ok: false as const,
          error: "Its L2 → L1 message is not an upgrade proposal",
          ...about,
          execution: null,
          idMatches: null,
        };
      }
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
        ...about,
        idMatches: upgradeProposalId(proposal) === item.l1ProposalId,
        execution: {
          ...execution,
          simulation: await simulate(execution, { keep: true, page: true }),
        },
      };
    })
  );
}

export function loader({ request }: LoaderFunctionArgs) {
  const days = startableDays(new URL(request.url).searchParams.get("days"));
  const found = notStartedUpgrades({ page: true, days });
  return defer({
    watch: watchItems(request, [watchKeys.startable(days)]),
    revs: loaderRevs([[watchKeys.startable(days), found.then(startableContent)]]),
    days,
    items: startable(found),
  });
}

export default function StartUpgrade() {
  const { items, days } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: $path("/app/proposals"), label: "Upgrades" }}
        eyebrow="Standard governance"
        title="Start an upgrade from L2"
      >
        <p className="max-w-[600px] text-[14px] text-slate-550">
          Once a ZkProtocolGovernor proposal is executed on ZKsync Era and its batch is final on L1,
          anyone can start the upgrade on L1 by proving the L2 → L1 message. Starting it begins the
          legal veto period.
        </p>
      </PageHeader>
      <LookBack days={days} />
      <Suspense
        key={days}
        fallback={<LoadingCard label="Looking for executed L2 protocol proposals…" />}
      >
        <Await
          resolve={items}
          errorElement={
            <EmptyState>
              The executed L2 protocol proposals could not be read. Refresh to retry.
            </EmptyState>
          }
        >
          {(list) =>
            list.length === 0 ? (
              <QuietEmpty>
                No L2 protocol proposal executed in the last {days} day{days === 1 ? "" : "s"} is
                waiting to be started.
              </QuietEmpty>
            ) : (
              <div className="space-y-4">
                {list.map((item) => (
                  <Card key={item.l2ProposalId} className="space-y-3 p-6">
                    {item.title && (
                      <p
                        className="font-semibold text-base text-navy-800"
                        data-testid="startable-title"
                      >
                        {item.title}
                      </p>
                    )}
                    <p className="font-medium text-slate-950">
                      L2 proposal{" "}
                      <span className="mono">{BigInt(item.l2ProposalId).toString()}</span>
                    </p>
                    <p className="text-slate-600 text-sm">
                      Executed on ZKsync Era
                      {item.executedAt !== null && (
                        <>
                          {" "}
                          on {formatDay(item.executedAt)} ({executedAgo(item.executedAt)})
                        </>
                      )}{" "}
                      in <TxLink hash={item.executedTx} l2 />
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

// How far back to look on ZKsync Era: the upgrade can be started on L1 at any time after its batch
// is executed there, so an older proposal can still be waiting.
function LookBack({ days }: { days: number }) {
  const navigation = useNavigation();
  return (
    <Form method="get" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label htmlFor="days" className="font-semibold text-[14px] text-navy-800">
        Executed on ZKsync Era in the last
      </label>
      <span className="flex items-center gap-2">
        <Input
          key={days}
          id="days"
          name="days"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_STARTABLE_DAYS}
          step={1}
          required
          defaultValue={days}
          className="h-10 w-24 tabular-nums"
        />
        <span className="text-[14px] text-slate-700">days</span>
      </span>
      <Button
        type="submit"
        variant="secondary"
        className="h-10"
        loading={navigation.state === "loading"}
      >
        Check
      </Button>
    </Form>
  );
}

function executedAgo(seconds: number) {
  const days = Math.floor((Date.now() / 1000 - seconds) / 86_400);
  return days < 1 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}
