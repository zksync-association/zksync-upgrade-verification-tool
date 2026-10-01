import { type StandardUpgradeDetail, getStandardUpgrade } from "@/.server/flows/standard";
import { parseId } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { useStatus } from "@/components/app-shell";
import { AddressLink, ExternalAnchor, Hash, TxLink } from "@/components/hex";
import { Check, EmptyState, Facts, LoadingCard, PageHeader, Section } from "@/components/page";
import { CallList } from "@/components/verification/calls";
import { ExecutionPanel } from "@/components/verification/execution-panel";
import { SignatureSetCard } from "@/components/verification/signature-set";
import { UpgradeStateBadge } from "@/components/verification/badges";
import { Timeline } from "@/components/verification/timeline";
import { UpgradeFile } from "@/components/verification/upgrade-file";
import { formatTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useAsyncError, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";
import { $path } from "remix-routes";
import { zeroAddress } from "viem";

export const meta = Meta["/app/proposals/:id"];

export function loader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.id);
  return defer({ id, detail: getStandardUpgrade(id, { supplied: suppliedSignatures(request) }) });
}

export default function UpgradePage() {
  const { id, detail } = useLoaderData<typeof loader>();
  return (
    <div>
      <Suspense
        fallback={
          <>
            <PageHeader
              back={{ to: $path("/app/proposals"), label: "Upgrades" }}
              eyebrow="Protocol upgrade"
              title="Upgrade"
              id={id}
            />
            <LoadingCard label="Reading the upgrade and checking every member's signature on-chain…" />
          </>
        }
      >
        <Await resolve={detail} errorElement={<DetailError id={id} />}>
          {(d) => <Detail detail={d} />}
        </Await>
      </Suspense>
    </div>
  );
}

function DetailError({ id }: { id: string }) {
  const error = useAsyncError() as Error;
  const notFound = error?.message?.includes("no standard upgrade");
  return (
    <>
      <PageHeader
        back={{ to: $path("/app/proposals"), label: "Upgrades" }}
        eyebrow="Protocol upgrade"
        title="Upgrade"
        id={id}
      />
      <EmptyState>
        {notFound ? (
          <>
            The ProtocolUpgradeHandler has no standard upgrade with this id.{" "}
            <Link
              className="text-brand-600 hover:underline"
              to={$path("/app/emergency/:id", { id })}
            >
              Open it as an emergency upgrade
            </Link>
            .
          </>
        ) : (
          <span className="text-red-700">{error?.message ?? "Failed to load"}</span>
        )}
      </EmptyState>
    </>
  );
}

function Detail({ detail: d }: { detail: SerializeFrom<StandardUpgradeDetail> }) {
  const { governance } = useStatus();
  const labels = {
    [governance.upgradeHandler.toLowerCase()]: "ProtocolUpgradeHandler",
    [governance.securityCouncil.address.toLowerCase()]: "SecurityCouncil",
    [governance.guardians.address.toLowerCase()]: "Guardians",
    [governance.emergencyUpgradeBoard.address.toLowerCase()]: "EmergencyUpgradeBoard",
  };
  const now = Number(governance.latestBlock.timestamp);
  const anyone = d.started.proposal.executor.toLowerCase() === zeroAddress;

  return (
    <div className="space-y-10">
      <PageHeader
        back={{ to: $path("/app/proposals"), label: "Upgrades" }}
        eyebrow="Protocol upgrade"
        title="Upgrade"
        badges={<UpgradeStateBadge state={d.state} />}
        id={d.id}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Facts
          items={[
            {
              label: "Started",
              value: (
                <span className="space-x-2">
                  <span>{formatTime(d.status.creationTimestamp)}</span>
                  <TxLink hash={d.started.txHash} />
                </span>
              ),
            },
            {
              label: "Executor",
              value: anyone ? "Anyone" : <AddressLink address={d.started.proposal.executor} />,
            },
            { label: "Salt", value: <Hash value={d.started.proposal.salt} /> },
            {
              label: "L2 vote",
              value: d.l2Proposal ? (
                <span className="space-x-2">
                  <span className="mono">
                    ZkProtocolGovernor #{shortId(d.l2Proposal.proposalId)}
                  </span>
                  {governance.network.tallyUrl && (
                    <ExternalAnchor
                      href={`${governance.network.tallyUrl}/proposal/${d.l2Proposal.proposalId}`}
                    >
                      Tally
                    </ExternalAnchor>
                  )}
                </span>
              ) : (
                <span className="text-slate-600">Not found on ZKsync Era</span>
              ),
            },
            {
              label: "Content matches the id",
              value: (
                <Check ok={d.started.idMatches}>
                  keccak256(abi.encode(calls, executor, salt)) {d.started.idMatches ? "=" : "≠"} id
                </Check>
              ),
              testId: "id-check",
            },
            {
              label: "Executed",
              value: d.executedTx ? (
                <TxLink hash={d.executedTx} />
              ) : (
                <span className="text-slate-600">Not yet</span>
              ),
            },
          ]}
        />
        <Timeline
          now={now}
          steps={[
            { label: "Started on L1", at: d.timeline.createdAt, done: true },
            {
              label: d.status.guardiansExtendedLegalVeto
                ? "Legal veto (extended to 7 days)"
                : "Legal veto period",
              at: d.timeline.legalVetoEndsAt,
              done: now >= d.timeline.legalVetoEndsAt,
              current: d.state === UPGRADE_STATES.LegalVetoPeriod,
            },
            {
              label: d.timeline.approvedAt
                ? "Approved by the Security Council"
                : "Waiting for approval (30 days)",
              at: d.timeline.approvedAt ?? d.timeline.waitingEndsAt,
              done: d.timeline.approvedAt !== null || d.status.guardiansApproval,
              current: d.state === UPGRADE_STATES.Waiting,
              failed: d.state === UPGRADE_STATES.Expired,
            },
            {
              label: "Ready to execute",
              at: d.timeline.readyAt,
              done: d.state === UPGRADE_STATES.Ready || d.state === UPGRADE_STATES.Done,
              current:
                d.state === UPGRADE_STATES.ExecutionPending || d.state === UPGRADE_STATES.Ready,
            },
            { label: "Executed", at: null, done: d.state === UPGRADE_STATES.Done },
          ]}
        />
      </div>

      <Section
        title={`What the upgrade does · ${d.calls.length} call${d.calls.length === 1 ? "" : "s"}`}
        description="Decoded from the UpgradeStarted event. The handler executes these calls in order when the upgrade runs."
      >
        <CallList calls={d.calls} labels={labels} />
        <UpgradeFile proposal={d.started.proposal} name={`upgrade-${d.id.slice(0, 10)}`} />
      </Section>

      <Section
        title="Approvals"
        description="Each member is a Safe. Its signature is looked up in the Safe Transaction Service by the hash this page computes, and counted only if the contract accepts it."
      >
        <div className="space-y-6">
          {d.sets.map((s) => (
            <SignatureSetCard
              key={s.key}
              testId={`set-${s.key}`}
              title={s.title}
              set={s.set}
              state={s.state}
              execution={s.execution}
              executionToLabel={s.key === "securityCouncil" ? "SecurityCouncil" : "Guardians"}
              used={s.used}
              historical={s.historical}
            />
          ))}
        </div>
      </Section>

      {d.execute && (
        <Section
          title="Execute the upgrade"
          description="Ready: the handler accepts execute(proposal) from the executor."
        >
          <ExecutionPanel
            execution={d.execute}
            toLabel="ProtocolUpgradeHandler"
            note={
              anyone
                ? "Anyone can execute this upgrade."
                : "Only the executor can execute this upgrade."
            }
          />
        </Section>
      )}
    </div>
  );
}

function shortId(id: string) {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id;
}
