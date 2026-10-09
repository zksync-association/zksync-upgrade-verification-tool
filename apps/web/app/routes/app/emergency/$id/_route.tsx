import { idContent, loaderRevs } from "@/.server/sync/content";
import { lastShown } from "@/.server/sync/last-shown";
import { pageLoad, watchKeys } from "@/.server/sync/presence";
import { freshAfter } from "@/.server/flows/common";
import {
  type EmergencyDetail,
  type EmergencyExecutionFirst,
  type EmergencyHistorical,
  type EmergencyOverview,
  loadEmergencyUpgrade,
} from "@/.server/flows/emergency";
import { governance } from "@/.server/governance";
import { parseId } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { simulate } from "@/.server/signatures";
import { emergencyExecution } from "@/common/execution";
import { type PayloadCheck, checkEmergencyPayload, decodeCall } from "@/common/proposal";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { Hash, TxLink } from "@/components/hex";
import { useLive } from "@/components/presence";
import { Check, EmptyState, Facts, LoadingCard, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CallList } from "@/components/verification/calls";
import { type AsOfBlock, AsOfContent, AsOfNote } from "@/components/verification/as-of";
import { ExecutionPanel, SimulationResult } from "@/components/verification/execution-panel";
import { type Refresh, setCurrency } from "@/components/verification/freshness";
import {
  LastRunCheck,
  LastRunText,
  type Provenance,
  provenanceOf,
} from "@/components/verification/last-run";
import { SignatureSetCard } from "@/components/verification/signature-set";
import { UntilFresh } from "@/components/verification/until-fresh";
import { UpgradeFile } from "@/components/verification/upgrade-file";
import { formatNumber } from "@/utils/format";
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
  // After a pause (no head in memory), the upgrade and its execution as this app last showed
  // them come first, as of their block, until the current ones replace them (sync/last-shown.ts).
  const shown = lastShown();
  // The page shows the signatures' first answer at once (possibly from an older block or older
  // Safe copies, labelled) and the strict result after it in the same response. Its sets' keys
  // join the page load's grace as they are found.
  const page = pageLoad(request, [watchKeys.emergency(id)]);
  const loading = page.run(() =>
    loadEmergencyUpgrade(id, { supplied: suppliedSignatures(request), freshness: "page" })
  );
  const key = `emergency:${id.toLowerCase()}`;
  // Only an execution this run's index found is kept: never one from the last run or located
  // directly.
  shown.keep(
    key,
    loading.then(
      async (d): Promise<LastShownEmergency> => ({
        overview: d.overview,
        execution: await d.executedFirst,
      })
    ),
    ({ execution }) => !execution || provenanceOf(execution) === null
  );
  return defer({
    watch: page.watch,
    // The upgrade's state and status, for its revision (its sets carry their own).
    revs: loaderRevs([[watchKeys.emergency(id), loading.then((d) => d.status).then(idContent)]]),
    id,
    lastShown: shown.held<LastShownEmergency>(key),
    detail: loading.then((d) => d.overview),
    // While this run's index reads the history, the execution may come first from the history
    // the last run saved, or be located directly (labelled); executedCheck confirms it against the
    // index.
    executed: loading.then((d) => d.executedFirst),
    executedCheck: loading.then((d) => d.executedCheck),
    // The board's re-checks at the block before the execution shown (archive reads): its calls
    // never wait for them.
    executedHistorical: loading.then((d) => d.executedHistorical),
    verified: loading.then((d) => d.first),
    verifiedFresh: loading.then((d) =>
      freshAfter(d.first, d.detail, (first) => first.roles.some((r) => r.set.stale === true))
    ),
  });
}

/** What the page keeps of an emergency upgrade, to show first after a pause (see the loader). */
type LastShownEmergency = {
  overview: EmergencyOverview;
  execution: EmergencyExecutionFirst | null;
};

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
  const { id, detail, lastShown } = useLoaderData<typeof loader>();
  const reading = (
    <>
      <PageHeader
        back={{ to: $path("/app/emergency"), label: "Emergency upgrades" }}
        eyebrow="Emergency upgrade"
        title="Emergency upgrade"
        id={id}
      />
      <LoadingCard label="Reading the emergency upgrade status from L1…" />
    </>
  );
  // After a pause, the upgrade as last shown (as of its block) until the current one replaces
  // it. The tree is the same either way once the current one is in, so a reload keeps it mounted.
  return (
    <Suspense fallback={reading}>
      <Await resolve={lastShown ?? null}>
        {(held) => (
          <UntilFresh stale={!!held} fresh={detail}>
            {(fresh, refresh) =>
              held && !fresh ? (
                <HeldDetail held={held} refresh={refresh} />
              ) : (
                <Suspense fallback={reading}>
                  <Await resolve={detail}>{(d) => <Detail detail={d} />}</Await>
                </Suspense>
              )
            }
          </UntilFresh>
        )}
      </Await>
    </Suspense>
  );
}

/**
 * The upgrade and its execution as this app last showed them, read at an older block (after a
 * pause): under a notice, in no colour, with nothing that waits on the current reads (the
 * signatures) and nothing to act on, until the current upgrade replaces it.
 */
function HeldDetail({
  held,
  refresh,
}: {
  held: SerializeFrom<LastShownEmergency> & { asOf: AsOfBlock };
  refresh: Refresh;
}) {
  const { executedHistorical } = useLoaderData<typeof loader>();
  const d = held.overview;
  const executed = d.state === UPGRADE_STATES.Done;
  return (
    <div className="space-y-10">
      <PageHeader
        back={{ to: $path("/app/emergency"), label: "Emergency upgrades" }}
        eyebrow="Emergency upgrade"
        title="Emergency upgrade"
        badges={
          <AsOfContent asOf={held.asOf} className="inline-flex">
            {executed ? <Badge>Executed</Badge> : <Badge>Not executed</Badge>}
          </AsOfContent>
        }
        id={d.id}
      />
      <AsOfNote
        asOf={held.asOf}
        refresh={refresh}
        what={executed ? "The state and the execution below" : "The state above"}
      />
      {executed && held.execution && (
        <AsOfContent asOf={held.asOf}>
          <ExecutedContent
            execution={held.execution}
            id={d.id}
            check={Promise.resolve(null)}
            historical={executedHistorical}
          />
        </AsOfContent>
      )}
      <LoadingCard label="Checking Security Council, Guardian and Foundation signatures at the newest block…" />
    </div>
  );
}

function Detail({ detail: d }: { detail: SerializeFrom<EmergencyOverview> }) {
  const {
    executed: execution,
    executedCheck,
    executedHistorical,
    verified,
    verifiedFresh,
  } = useLoaderData<typeof loader>();
  // The governance this upgrade was read with: the page never waits on the root status for it.
  const board = d.governance.emergencyUpgradeBoard.address;
  const executed = d.state === UPGRADE_STATES.Done;
  const [check, setCheck] = useState<PayloadCheck | null>(null);

  useEffect(() => {
    if (executed) return;
    const stored = loadPayload(d.id);
    if (stored) setCheck(checkEmergencyPayload(stored, d.id as Hex, board as Hex));
  }, [d.id, board, executed]);

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

      {executed ? (
        <Suspense
          fallback={
            <LoadingCard label="Locating the emergency execution and checking its original calls…" />
          }
        >
          <Await
            resolve={execution}
            errorElement={
              <EmptyState>Emergency execution lookup unavailable. Refresh to retry.</EmptyState>
            }
          >
            {(execution) =>
              execution ? (
                <ExecutedContent
                  execution={execution}
                  id={d.id}
                  check={executedCheck}
                  historical={executedHistorical}
                />
              ) : (
                <EmptyState>
                  No emergency execution event was found for this id. The completed state alone does
                  not establish an emergency upgrade.
                </EmptyState>
              )
            }
          </Await>
        </Suspense>
      ) : (
        <Section
          title="What it will do"
          description="Safe stores only the id. Load the payload the proposer shared; it is checked against the id here in your browser and never sent to the server."
        >
          <PayloadLoader id={d.id} board={board} check={check} onCheck={setCheck} />
        </Section>
      )}

      <Suspense
        fallback={
          <LoadingCard label="Checking Security Council, Guardian and Foundation signatures on-chain…" />
        }
      >
        <Await
          resolve={verified}
          errorElement={
            <EmptyState>Signature verification unavailable. Refresh to retry.</EmptyState>
          }
        >
          {(first) => (
            // A stale first answer shows until the strict result streams in.
            <UntilFresh stale={first.roles.some((r) => r.set.stale === true)} fresh={verifiedFresh}>
              {(fresh, refresh) => (
                <SignatureSections
                  detail={fresh ?? first}
                  board={board}
                  check={check}
                  refresh={fresh ? null : refresh}
                />
              )}
            </UntilFresh>
          )}
        </Await>
      </Suspense>
    </div>
  );
}

/** Where the execution's calls came from, while this run's log index has not confirmed it yet. */
const EXECUTION_SOURCE: Record<Provenance, { pending: string; failed: string }> = {
  "last-run": {
    pending:
      "Rebuilt from the executeEmergencyUpgrade calldata of the execution transaction in the history saved by the last run (re-verifying), and hashed again with the board as executor.",
    failed:
      "Rebuilt from an execution transaction in the history saved by the last run, which the chain's current history did not confirm. Do not rely on these calls; reload the page.",
  },
  direct: {
    pending:
      "Rebuilt from the executeEmergencyUpgrade calldata of the execution transaction, located directly from archive state while the history index is verifying, and hashed again with the board as executor.",
    failed:
      "Rebuilt from an execution transaction located directly, which the handler's complete log history did not confirm. Do not rely on these calls; reload the page.",
  },
};

function ExecutedContent({
  execution,
  id,
  check,
  historical,
}: {
  execution: SerializeFrom<EmergencyExecutionFirst>;
  id: string;
  /** For an execution from the last run's history or located directly: its confirmation. */
  check: Promise<unknown>;
  /** The board's checks re-run at the block before this execution. */
  historical: Promise<SerializeFrom<EmergencyHistorical> | null>;
}) {
  const provenance = provenanceOf(execution);
  return (
    <Section
      title="What it did"
      description={
        // An execution from the last run's history, or located directly, says so until this
        // run's history confirms it (the same transaction and block), then reads as any other.
        <LastRunText
          check={provenance ? check : null}
          pending={EXECUTION_SOURCE[provenance ?? "last-run"].pending}
          confirmed="Rebuilt from the executeEmergencyUpgrade calldata of the execution transaction, and hashed again with the board as executor."
          failed={EXECUTION_SOURCE[provenance ?? "last-run"].failed}
        />
      }
    >
      <Facts
        items={[
          {
            label: "Executed in",
            value: (
              <span className="block space-y-1">
                <TxLink hash={execution.txHash} />
                {provenance && <LastRunCheck check={check} source={provenance} what="execution" />}
              </span>
            ),
          },
          { label: "Salt", value: <Hash value={execution.proposal.salt} /> },
          {
            label: "Calls and salt match the id",
            value: (
              <Check ok={execution.idMatches}>
                keccak256(abi.encode(calls, board, salt)) {execution.idMatches ? "=" : "≠"} id
              </Check>
            ),
            testId: "id-check",
          },
          {
            label: "Board's checks before execution",
            value: (
              <BoardChecks
                historical={historical}
                block={BigInt(execution.blockNumber) - 1n}
                check={provenance ? check : null}
              />
            ),
            testId: "board-checks",
          },
        ]}
      />
      <CallList calls={execution.calls} />
      <UpgradeFile proposal={execution.proposal} name={`emergency-${id.slice(0, 10)}`} />
    </Section>
  );
}

/**
 * The board's three checks re-run at the block before the execution (archive reads), streamed
 * after its calls. For an execution this run's index has not confirmed yet (`check` pending), they
 * are the checks of that unconfirmed transaction, and say so until it is confirmed.
 */
function BoardChecks({
  historical,
  block,
  check,
}: {
  historical: Promise<SerializeFrom<EmergencyHistorical> | null>;
  block: bigint;
  check: Promise<unknown> | null;
}) {
  return (
    <Suspense
      fallback={
        <span role="status" className="text-slate-600">
          Re-running the board's checks at block {block.toString()}…
        </span>
      }
    >
      <Await
        resolve={historical}
        errorElement={
          <span className="text-slate-600">
            The board's checks could not be re-run. Refresh to retry.
          </span>
        }
      >
        {(h) =>
          h?.historical ? (
            <span className="flex flex-col gap-0.5">
              {h.historical.checks.map((c) => (
                <Check key={c.role} ok={c.accepted}>
                  {c.role}{" "}
                  {c.accepted === true
                    ? "accepted"
                    : c.accepted === false
                      ? `rejected (${c.error})`
                      : `not checked (${c.error})`}
                </Check>
              ))}
              {check && (
                <span className="text-amber-900 text-xs" data-testid="board-checks-unconfirmed">
                  <LastRunText
                    check={check}
                    pending="At the block before this execution, which the history index has not confirmed yet."
                    confirmed=""
                    failed=""
                  />
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-600">
              {h?.historicalUnavailable ?? "The board's checks were not re-run."}
            </span>
          )
        }
      </Await>
    </Suspense>
  );
}

function SignatureSections({
  detail: d,
  board,
  check,
  refresh,
}: {
  detail: SerializeFrom<EmergencyDetail>;
  board: string;
  check: PayloadCheck | null;
  refresh: Refresh;
}) {
  const executed = d.state === UPGRADE_STATES.Done;
  const live = useLive();
  // A stale first answer (an older block, or old Safe copies) never makes a transaction to send.
  const metLoaded = (r: (typeof d.roles)[number]) =>
    r.set.thresholdCheck.status === "met" && r.set.stale !== true;
  // A set the app did not verify at the head it serves now is not met now (see setCurrency).
  const behindAt = (r: (typeof d.roles)[number]) => setCurrency(r.set, live).behind;
  const metNow = (r: (typeof d.roles)[number]) => metLoaded(r) && behindAt(r) === null;
  const allMet = d.roles.every(metLoaded);
  const behind = d.roles.map(behindAt).find((at) => at !== null) ?? null;
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
              refresh={refresh}
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
              blockedReason={
                behind === null ? null : `Not verified at block #${formatNumber(behind)} yet.`
              }
            />
          ) : (
            <Card className="p-6 text-slate-950 text-sm">
              <ul className="space-y-1">
                <li>
                  <Check ok={check?.ok ?? null}>Payload loaded and matching the id</Check>
                </li>
                {d.roles.map((r) => (
                  <li key={r.key}>
                    <Check ok={metNow(r) ? true : null}>
                      {r.title}: {r.set.valid.length} of {r.set.threshold}
                      {r.set.stale &&
                        ` (at block #${r.set.verifiedAtBlock ?? "?"}, checking again)`}
                      {!r.set.stale &&
                        behindAt(r) !== null &&
                        ` (at block #${setCurrency(r.set, live).block ?? "?"}, not verified at #${behindAt(r)} yet)`}
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
          <p className="flex items-center gap-2 text-green-900 text-sm">
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
        <p className="flex items-start gap-2 text-red-800 text-sm" data-testid="payload-error">
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
