import { type VetoDetail, getL2Veto } from "@/.server/flows/l2-veto";
import { parseVetoParams } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { decodeCall } from "@/common/proposal";
import { useStatus } from "@/components/app-shell";
import { AddressLink, ExternalAnchor, TxLink } from "@/components/hex";
import { Check, EmptyState, Facts, LoadingCard, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { CallList } from "@/components/verification/calls";
import { SetStateBadge } from "@/components/verification/badges";
import { SignatureSetCard } from "@/components/verification/signature-set";
import { formatEth, formatTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/l2-cancellations/:id"];

export function loader({ params, request }: LoaderFunctionArgs) {
  const veto = parseVetoParams(params.id, new URL(request.url));
  return defer({ veto, detail: getL2Veto(veto, { supplied: suppliedSignatures(request) }) });
}

export default function VetoPage() {
  const { veto, detail } = useLoaderData<typeof loader>();
  return (
    <Suspense
      fallback={
        <>
          <PageHeader
            back={{ to: $path("/app/l2-cancellations"), label: "Guardian veto" }}
            eyebrow="Guardian veto"
            title="Veto"
            id={veto.l2ProposalId}
          />
          <LoadingCard label="Reading the L2 proposal and checking Guardian signatures on-chain…" />
        </>
      }
    >
      <Await resolve={detail}>{(d) => <Detail detail={d} />}</Await>
    </Suspense>
  );
}

function Detail({ detail: d }: { detail: SerializeFrom<VetoDetail> }) {
  const { governance } = useStatus();
  const p = d.params;
  const l2 = d.l2Proposal;
  return (
    <div className="space-y-10">
      <PageHeader
        back={{ to: $path("/app/l2-cancellations"), label: "Guardian veto" }}
        eyebrow="Guardian veto"
        title={l2?.description.split("\n")[0] || "Veto of an L2 proposal"}
        badges={
          <>
            <SetStateBadge state={d.state} />
            {!d.governorKnown && <Badge variant="error">Not a known governor</Badge>}
          </>
        }
        id={p.l2ProposalId}
      />
      <Facts
        items={[
          {
            label: "L2 governor",
            value: <AddressLink address={p.l2GovernorAddress} label={l2?.governorName} l2 />,
          },
          {
            label: "L2 proposal",
            value: l2 ? (
              <span className="space-x-2">
                <span>{l2.state ?? "state unknown"}</span>
                <span className="text-slate-600">
                  voting {formatTime(l2.voteStart)} → {formatTime(l2.voteEnd)}
                </span>
                {governance.network.tallyUrl && (
                  <ExternalAnchor
                    href={`${governance.network.tallyUrl}/proposal/${p.l2ProposalId}`}
                  >
                    Tally
                  </ExternalAnchor>
                )}
              </span>
            ) : d.l2Error ? (
              <span className="text-amber-900" data-testid="l2-error">
                Not read from ZKsync Era: {d.l2Error}
              </span>
            ) : (
              <span className="text-amber-900">Not found on ZKsync Era</span>
            ),
          },
          {
            label: "L1 → L2 transaction",
            value: `gas limit ${p.l2GasLimit} · ${p.l2GasPerPubdataByteLimit} gas per pubdata byte`,
          },
          { label: "Mint value (sent with the L1 transaction)", value: formatEth(p.txMintValue) },
          {
            label: "Refund recipient on L2",
            value: <AddressLink address={p.refundRecipient} l2 />,
          },
          {
            label: "Nonce",
            value: `${p.nonce} (Guardians' next is ${governance.guardians.nonce})`,
          },
        ]}
      />
      <Section
        title="The proposal being cancelled"
        description="From the governor's ProposalCreated event on ZKsync Era. Guardians sign only its id; the content is checked against it."
      >
        {l2 ? (
          <div className="space-y-4">
            <Facts
              items={[
                {
                  label: "Content matches the signed id",
                  value: (
                    <span className="flex flex-col gap-0.5">
                      <Check ok={l2.idMatchesLocal}>hashL2Proposal recomputed here</Check>
                      <Check ok={l2.idMatchesContract}>Guardians.hashL2Proposal on L1</Check>
                    </span>
                  ),
                  testId: "id-check",
                },
                { label: "Proposer", value: <AddressLink address={l2.proposer} l2 /> },
                { label: "Created in", value: <TxLink hash={l2.createdTx} l2 /> },
              ]}
            />
            <CallList
              calls={l2.targets.map((target, i) =>
                decodeCall({ target, value: l2.values[i] ?? "0", data: l2.calldatas[i] ?? "0x" })
              )}
            />
            <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-950">
                Full description
              </summary>
              <pre className="mt-3 whitespace-pre-wrap text-slate-950">{l2.description}</pre>
            </details>
          </div>
        ) : (
          <EmptyState>
            {d.l2Error
              ? "The L2 proposal could not be read, so the veto cannot be executed from here yet. Refresh to retry."
              : "The proposal was not found on this governor, so the veto cannot be executed from here."}
          </EmptyState>
        )}
      </Section>
      <SignatureSetCard
        testId="set-veto"
        title="Guardian signatures"
        set={d.set}
        state={d.state}
        execution={d.execution}
        executionToLabel="Guardians"
      />
    </div>
  );
}
