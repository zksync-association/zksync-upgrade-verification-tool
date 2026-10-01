import { type EmergencyDetail, getEmergencyUpgrade } from "@/.server/flows/emergency";
import { governance } from "@/.server/governance";
import { parseId } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { simulate } from "@/.server/signatures";
import { emergencyExecution } from "@/common/execution";
import { type PayloadCheck, checkEmergencyPayload, decodeCall } from "@/common/proposal";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { useStatus } from "@/components/app-shell";
import { Hash, TxLink } from "@/components/hex";
import { Check, Facts, LoadingCard, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CallList } from "@/components/verification/calls";
import { ExecutionPanel, SimulationResult } from "@/components/verification/execution-panel";
import { SignatureSetCard } from "@/components/verification/signature-set";
import { UpgradeFile } from "@/components/verification/upgrade-file";
import { badRequest } from "@/utils/http";
import { Meta } from "@/utils/meta";
import { forgetPayload, loadPayload, savePayload } from "@/utils/payload-storage";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type SerializeFrom,
  defer,
  json,
} from "@remix-run/node";
import { Await, useFetcher, useLoaderData } from "@remix-run/react";
import { CheckCircle2, FileJson, Upload, XCircle } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { $path } from "remix-routes";
import { type Hex, isAddressEqual } from "viem";
import { z } from "zod";

export const meta = Meta["/app/emergency/:id"];

export function loader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.id);
  return defer({ id, detail: getEmergencyUpgrade(id, { supplied: suppliedSignatures(request) }) });
}

// Opt-in simulation of the execution transaction. Only calls to the Emergency Upgrade Board are
// accepted, so this is not a general eth_call proxy.
export async function action({ request }: ActionFunctionArgs) {
  const body = z
    .object({
      to: z.string(),
      data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/),
      value: z.string().regex(/^\d+$/),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) throw badRequest("Invalid simulation request");
  const gov = await governance();
  if (!isAddressEqual(body.data.to as Hex, gov.emergencyUpgradeBoard.address))
    throw badRequest("Only the Emergency Upgrade Board");
  return json({
    simulation: await simulate({
      to: body.data.to as Hex,
      data: body.data.data as Hex,
      value: body.data.value,
    }),
  });
}

export default function EmergencyPage() {
  const { id, detail } = useLoaderData<typeof loader>();
  return (
    <Suspense
      fallback={
        <>
          <PageHeader
            back={{ to: $path("/app/emergency"), label: "Emergency upgrades" }}
            eyebrow="Emergency upgrade"
            title="Emergency upgrade"
            id={id}
          />
          <LoadingCard label="Checking Security Council, Guardian and Foundation signatures on-chain…" />
        </>
      }
    >
      <Await resolve={detail}>{(d) => <Detail detail={d} />}</Await>
    </Suspense>
  );
}

function Detail({ detail: d }: { detail: SerializeFrom<EmergencyDetail> }) {
  const { governance } = useStatus();
  const board = governance.emergencyUpgradeBoard.address;
  const executed = d.state === UPGRADE_STATES.Done;
  const [check, setCheck] = useState<PayloadCheck | null>(null);

  useEffect(() => {
    if (executed) return;
    const stored = loadPayload(d.id);
    if (stored) setCheck(checkEmergencyPayload(stored, d.id as Hex, board as Hex));
  }, [d.id, board, executed]);

  const allMet = d.roles.every((r) => r.set.thresholdCheck.status === "met");
  const zkf = d.roles.find((r) => r.key === "zkFoundation");
  const execution = useMemo(() => {
    if (executed || !check?.ok || !allMet || !zkf?.set.valid[0]) return null;
    const role = (key: string) =>
      (d.roles.find((r) => r.key === key)?.set.valid ?? []) as { signer: Hex; signature: Hex }[];
    return emergencyExecution(
      board as Hex,
      check.proposal,
      role("guardians"),
      role("securityCouncil"),
      zkf.set.valid[0].signature as Hex
    );
  }, [executed, check, allMet, zkf, d.roles, board]);

  return (
    <div className="space-y-10">
      <PageHeader
        back={{ to: $path("/app/emergency"), label: "Emergency upgrades" }}
        eyebrow="Emergency upgrade"
        title="Emergency upgrade"
        badges={
          executed ? (
            <Badge variant="success">Executed</Badge>
          ) : (
            <Badge variant="warning">Not executed</Badge>
          )
        }
        id={d.id}
      />

      {d.executed ? (
        <Section
          title="What it did"
          description="Rebuilt from the executeEmergencyUpgrade calldata of the execution transaction, and hashed again with the board as executor."
        >
          <Facts
            items={[
              { label: "Executed in", value: <TxLink hash={d.executed.txHash} /> },
              { label: "Salt", value: <Hash value={d.executed.proposal.salt} /> },
              {
                label: "Calls and salt match the id",
                value: (
                  <Check ok={d.executed.idMatches}>
                    keccak256(abi.encode(calls, board, salt)) {d.executed.idMatches ? "=" : "≠"} id
                  </Check>
                ),
                testId: "id-check",
              },
              {
                label: "Board's checks before execution",
                value: d.executed.historical ? (
                  <span className="flex flex-col gap-0.5">
                    {d.executed.historical.checks.map((c) => (
                      <Check key={c.role} ok={c.accepted}>
                        {c.role}{" "}
                        {c.accepted === true
                          ? "accepted"
                          : c.accepted === false
                            ? `rejected (${c.error})`
                            : `not checked (${c.error})`}
                      </Check>
                    ))}
                  </span>
                ) : (
                  <span className="text-slate-600">{d.executed.historicalUnavailable}</span>
                ),
              },
            ]}
          />
          <CallList calls={d.executed.calls} />
          <UpgradeFile proposal={d.executed.proposal} name={`emergency-${d.id.slice(0, 10)}`} />
        </Section>
      ) : (
        <Section
          title="What it will do"
          description="Safe stores only the id. Load the payload the proposer shared; it is checked against the id here in your browser and never sent to the server."
        >
          <PayloadLoader id={d.id} board={board} check={check} onCheck={setCheck} />
        </Section>
      )}

      <Section
        title="Signatures"
        description="All three are needed. The board checks each group through its EIP-1271 isValidSignature."
      >
        <div className="space-y-6">
          {d.roles.map((r) => (
            <SignatureSetCard
              key={r.key}
              testId={`set-${r.key}`}
              title={r.title}
              set={r.set}
              state={
                executed
                  ? {
                      status: "done",
                      detail: "The emergency upgrade was executed",
                      txHash: d.executed?.txHash ?? null,
                    }
                  : { status: "open" }
              }
              used={r.used}
            />
          ))}
        </div>
      </Section>

      {!executed && (
        <Section title="Execute" description="Needs the payload and all three groups' thresholds.">
          {execution ? (
            <ExecutionPanel
              execution={execution}
              toLabel="EmergencyUpgradeBoard"
              extra={<SimulateButton execution={execution} />}
            />
          ) : (
            <Card className="p-6 text-slate-950 text-sm">
              <ul className="space-y-1">
                <li>
                  <Check ok={check?.ok ?? null}>Payload loaded and matching the id</Check>
                </li>
                {d.roles.map((r) => (
                  <li key={r.key}>
                    <Check ok={r.set.thresholdCheck.status === "met" ? true : null}>
                      {r.title}: {r.set.valid.length} of {r.set.threshold}
                    </Check>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>
      )}
    </div>
  );
}

function PayloadLoader({
  id,
  board,
  check,
  onCheck,
}: {
  id: string;
  board: string;
  check: PayloadCheck | null;
  onCheck: (c: PayloadCheck | null) => void;
}) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const accept = (raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      onCheck({ ok: false, error: "Not valid JSON" });
      return;
    }
    const result = checkEmergencyPayload(parsed, id as Hex, board as Hex);
    onCheck(result);
    if (result.ok) savePayload(id, parsed);
  };

  const fetchUrl = async () => {
    setBusy(true);
    try {
      // Fetched by the browser, not the server (the URL must allow CORS, as raw GitHub and gists do).
      const response = await fetch(url, { credentials: "omit" });
      accept(await response.text());
    } catch (error) {
      onCheck({ ok: false, error: `Could not fetch: ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  if (check?.ok) {
    return (
      <div className="space-y-4" data-testid="payload-ok">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="flex items-center gap-2 text-green-800 text-sm">
            <CheckCircle2 className="h-4 w-4" /> The payload hashes to this id
            {check.title && (
              <span className="text-slate-950">· “{check.title}” (title is not signed)</span>
            )}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              forgetPayload(id);
              onCheck(null);
            }}
          >
            Load another
          </Button>
        </div>
        <Facts items={[{ label: "Salt", value: <Hash value={check.proposal.salt} /> }]} />
        <CallList calls={check.proposal.calls.map(decodeCall)} />
        <UpgradeFile proposal={check.proposal} name={`emergency-${id.slice(0, 10)}`} />
      </div>
    );
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="font-medium text-[13px] text-slate-950" htmlFor="payload-json">
            Paste the payload JSON
          </label>
          <Textarea
            id="payload-json"
            className="mono min-h-36"
            placeholder={
              '{ "salt": "0x…", "calls": [{ "target": "0x…", "value": "0", "data": "0x…" }] }'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => accept(text)}
              disabled={!text.trim()}
              data-testid="check-payload"
            >
              <FileJson /> Check payload
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 font-semibold text-[13px] hover:bg-slate-50">
              <Upload className="h-4 w-4" /> Upload file
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => e.target.files?.[0]?.text().then(accept)}
              />
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <label className="font-medium text-[13px] text-slate-950" htmlFor="payload-url">
            Or fetch it from a URL
          </label>
          <Input
            id="payload-url"
            placeholder="https://…/payload.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button size="sm" variant="secondary" onClick={fetchUrl} disabled={!url} loading={busy}>
            Fetch in this browser
          </Button>
          <p className="text-slate-600 text-xs">
            Format: <span className="mono">salt</span>, <span className="mono">calls[]</span> of{" "}
            <span className="mono">{"{ target, value, data }"}</span>, optional{" "}
            <span className="mono">title</span> and <span className="mono">executor</span>.
          </p>
        </div>
      </div>
      {check && !check.ok && (
        <p className="flex items-start gap-2 text-red-700 text-sm" data-testid="payload-error">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {check.error}
        </p>
      )}
    </Card>
  );
}

function SimulateButton({ execution }: { execution: { to: string; data: string; value: string } }) {
  const fetcher = useFetcher<typeof action>();
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        loading={fetcher.state !== "idle"}
        onClick={() => fetcher.submit(execution, { method: "POST", encType: "application/json" })}
      >
        Simulate via your RPC
      </Button>
      <p className="text-slate-600 text-xs">
        Sends the calldata, including the payload, to this app's RPC as an eth_call.
      </p>
      {fetcher.data?.simulation && <SimulationResult simulation={fetcher.data.simulation} />}
    </div>
  );
}
