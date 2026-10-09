import { knownGovernors } from "@/.server/flows/l2";
import { VETO_DEFAULTS, vetoPath } from "@/common/veto";
import { useStatus } from "@/components/app-shell";
import { LoadingCard, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, useLoaderData, useNavigate } from "@remix-run/react";
import { Suspense, useState } from "react";
import { $path } from "remix-routes";
import { formatEther, isAddress, parseEther } from "viem";
import { useAccount } from "wagmi";

export const meta = Meta["/app/l2-cancellations/new"];

// Deferred: the page is sent before the governors are known (they need the network read).
export function loader({ request }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const form = knownGovernors().then((all) => {
    const governors = all.filter((g) => g.kind !== "protocol");
    return {
      governors,
      governor: query.get("governor") ?? governors[0]?.address ?? "",
      proposalId: query.get("proposalId") ?? "",
    };
  });
  return defer({ form });
}

type VetoFormData = SerializeFrom<typeof loader>["form"] extends Promise<infer F> ? F : never;

export default function NewVeto() {
  const { form } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<LoadingCard label="Reading the L2 governors…" />}>
      <Await resolve={form}>{(data) => <VetoForm data={data} />}</Await>
    </Suspense>
  );
}

function VetoForm({ data }: { data: VetoFormData }) {
  const { governance } = useStatus();
  const { address } = useAccount();
  const navigate = useNavigate();
  const [governor, setGovernor] = useState(data.governor);
  const [proposalId, setProposalId] = useState(data.proposalId);
  const [gasLimit, setGasLimit] = useState(VETO_DEFAULTS.l2GasLimit);
  const [gasPerPubdata, setGasPerPubdata] = useState(VETO_DEFAULTS.l2GasPerPubdataByteLimit);
  const [refund, setRefund] = useState(address ?? "");
  const [mintEth, setMintEth] = useState(formatEther(BigInt(VETO_DEFAULTS.txMintValue)));
  const [nonce, setNonce] = useState(governance.guardians.nonce);

  let mint: string | null = null;
  try {
    mint = parseEther(mintEth).toString();
  } catch {}
  const valid =
    isAddress(governor) &&
    /^\d+$/.test(proposalId) &&
    /^\d+$/.test(gasLimit) &&
    /^\d+$/.test(gasPerPubdata) &&
    isAddress(refund) &&
    mint !== null &&
    /^\d+$/.test(nonce);

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ to: $path("/app/l2-cancellations"), label: "Guardian veto" }}
        eyebrow="Guardians"
        title="Prepare a veto"
      >
        <p className="max-w-3xl text-slate-950">
          Every field below is signed. All Guardians must sign the same values, so share the
          resulting page link with them.
        </p>
      </PageHeader>
      <Card className="grid max-w-3xl gap-5 p-6 sm:grid-cols-2">
        <Field label="L2 governor" className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {data.governors.map((g) => (
              <Button
                key={g.address}
                type="button"
                size="sm"
                variant={g.address === governor ? "default" : "outline"}
                onClick={() => setGovernor(g.address)}
              >
                {g.name}
              </Button>
            ))}
          </div>
          <Input
            className="mono text-[12px]"
            value={governor}
            onChange={(e) => setGovernor(e.target.value)}
          />
        </Field>
        <Field label="L2 proposal id (decimal)" className="sm:col-span-2">
          <Input
            className="mono text-[12px]"
            value={proposalId}
            onChange={(e) => setProposalId(e.target.value.trim())}
          />
        </Field>
        <Field label="L2 gas limit">
          <Input value={gasLimit} onChange={(e) => setGasLimit(e.target.value.trim())} />
        </Field>
        <Field label="L2 gas per pubdata byte">
          <Input value={gasPerPubdata} onChange={(e) => setGasPerPubdata(e.target.value.trim())} />
        </Field>
        <Field label="Mint value (ETH), sent with the L1 transaction">
          <Input value={mintEth} onChange={(e) => setMintEth(e.target.value.trim())} />
        </Field>
        <Field label={`Nonce (Guardians' next is ${governance.guardians.nonce})`}>
          <Input value={nonce} onChange={(e) => setNonce(e.target.value.trim())} />
        </Field>
        <Field label="Refund recipient on L2" className="sm:col-span-2">
          <Input
            className="mono text-[12px]"
            value={refund}
            onChange={(e) => setRefund(e.target.value.trim())}
            placeholder="0x…"
          />
        </Field>
        <div className="sm:col-span-2">
          <Button
            disabled={!valid}
            onClick={() =>
              navigate(
                vetoPath({
                  l2ProposalId: proposalId,
                  l2GovernorAddress: governor,
                  l2GasLimit: gasLimit,
                  l2GasPerPubdataByteLimit: gasPerPubdata,
                  refundRecipient: refund,
                  txMintValue: mint ?? "0",
                  nonce,
                })
              )
            }
          >
            Open veto page
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
