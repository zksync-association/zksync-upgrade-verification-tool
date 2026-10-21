import { type DraftCallCheck, checkDraftCalls } from "@/.server/flows/emergency-draft";
import { decodeCall, emergencyPayloadSchema, upgradeProposalId } from "@/common/proposal";
import { WithStatus } from "@/components/governance-context";
import { CopyButton, Hash } from "@/components/hex";
import { PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { JsonDrop, OpenJsonFile } from "@/components/ui/json-drop";
import { ToolButton, Toolbar } from "@/components/ui/tool-button";
import { cn } from "@/utils/cn";
import { formatNumber } from "@/utils/format";
import { badRequest } from "@/utils/http";
import { Meta } from "@/utils/meta";
import { savePayload } from "@/utils/payload-storage";
import { type ActionFunctionArgs, json } from "@remix-run/node";
import { useFetcher, useNavigate } from "@remix-run/react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  History,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { $path } from "remix-routes";
import { type Hex, formatEther, getAddress, isAddress, isHex, parseEther, toHex } from "viem";
import { z } from "zod";

export const meta = Meta["/app/emergency/new"];

// Checks each call by eth_call from the ProtocolUpgradeHandler, which is who executes them.
// Opt-in: it sends the calls to this app's RPC. A call "reverts" only on the node's definite
// revert; an RPC failure reads "could not check" (ok: null), never as a revert.
export async function action({ request }: ActionFunctionArgs) {
  const body = z
    .object({
      calls: z
        .array(
          z.object({
            target: z.string().refine((target) => isAddress(target)),
            value: z.string().regex(/^\d{1,78}$/),
            data: z.string().refine((data) => isHex(data) && data.length % 2 === 0),
          })
        )
        .max(64),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) throw badRequest("Invalid calls");
  const { results, atBlock } = await checkDraftCalls(
    body.data.calls.map((call) => ({
      target: getAddress(call.target),
      value: BigInt(call.value),
      data: call.data as Hex,
    }))
  );
  return json({ results, atBlock });
}

type Draft = { key: number; target: string; valueEth: string; data: string };

let nextKey = 1;
const emptyCall = (): Draft => ({ key: nextKey++, target: "", valueEth: "0", data: "0x" });
type Built =
  | { ok: false; error: string }
  | {
      ok: true;
      id: Hex;
      payload: {
        title?: string;
        executor: Hex;
        salt: string;
        calls: { target: Hex; value: string; data: Hex }[];
      };
    };

// A value in ETH as the payload has it (wei); one that is not a number stays as typed (and fails).
const weiOf = (eth: string) => {
  try {
    return parseEther(eth || "0").toString();
  } catch {
    return eth;
  }
};

export default function NewEmergency() {
  const fetcher = useFetcher<typeof action>();
  const [title, setTitle] = useState("");
  const [salt, setSalt] = useState<string>(`0x${"0".repeat(64)}`);
  const [calls, setCalls] = useState<Draft[]>(() => [emptyCall()]);
  const update = (i: number, patch: Partial<Draft>) =>
    setCalls(calls.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  // The payload as JSON, pasted or edited: each valid text fills the form (the id follows it);
  // one that is not valid says why, and nothing is built from it.
  const [mode, setMode] = useState<"form" | "json">("form");
  const [text, setText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [executor, setExecutor] = useState<string | null>(null);
  // The calls the last check ran on: its answer for a call applies only while that call is
  // unchanged (an edit after it is said, never shown under the old verdict).
  const [checked, setChecked] = useState<Checked[] | null>(null);
  const keys = calls.map((c) =>
    checkKey({ target: c.target, value: weiOf(c.valueEth), data: c.data })
  );
  const answers = fetcher.state === "idle" && fetcher.data && checked ? fetcher.data.results : null;
  const changed =
    !!answers &&
    !!checked &&
    (checked.length !== keys.length || checked.some((c, i) => checkKey(c) !== keys[i]));
  const lineOf = (i: number): DraftCallCheck | "changed" | undefined =>
    !answers || !checked?.[i]
      ? undefined
      : checkKey(checked[i]) === keys[i]
        ? answers[i]
        : "changed";
  // A row of the check's answers shows its call: in the form, scrolled to and outlined briefly.
  const [flash, setFlash] = useState<number | null>(null);
  const showCall = (i: number) => {
    setJsonError(null);
    setMode("form");
    requestAnimationFrame(() =>
      document
        .getElementById(`draft-call-${i + 1}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
    setFlash(i);
    setTimeout(() => setFlash((f) => (f === i ? null : f)), 1600);
  };
  const toJson = () =>
    JSON.stringify(
      {
        ...(title ? { title } : {}),
        salt,
        calls: calls.map((c) => ({ target: c.target, value: weiOf(c.valueEth), data: c.data })),
      },
      null,
      2
    );
  // A file dropped or opened: shown in JSON mode, as if pasted.
  const loadJson = (value: string) => {
    setMode("json");
    fromJson(value);
  };
  const failJson = (message: string) => {
    setMode("json");
    setJsonError(message);
  };
  const fromJson = (value: string) => {
    setText(value);
    let raw: unknown;
    try {
      raw = JSON.parse(value);
    } catch {
      setJsonError("Not valid JSON.");
      return;
    }
    const parsed = emergencyPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setJsonError(`Invalid payload: ${issue?.path.join(".") || "root"} ${issue?.message}.`);
      return;
    }
    setJsonError(null);
    setTitle(parsed.data.title ?? "");
    setSalt(parsed.data.salt);
    setExecutor(parsed.data.executor ?? null);
    setCalls(
      parsed.data.calls.map((c) => ({
        key: nextKey++,
        target: c.target,
        valueEth: formatEther(BigInt(c.value)),
        data: c.data,
      }))
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: $path("/app/emergency"), label: "Emergency upgrades" }}
        eyebrow="Emergency upgrade"
        title="Prepare an emergency upgrade"
      >
        <p className="max-w-[600px] text-[14px] text-slate-550">
          Build the payload, share the JSON with every signer through your usual private channel,
          then sign its id from your Safe. Safe only ever stores the id; signers check the payload
          against it themselves.
        </p>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* A payload file dropped on the card loads like a paste (read here, never uploaded). */}
        <JsonDrop onText={loadJson} onError={failJson}>
          <Card className="space-y-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-[15px] text-navy-800">Payload</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <OpenJsonFile onText={loadJson} onError={failJson} />
                <Toolbar label="Edit as">
                  <ToolButton
                    pressed={mode === "form"}
                    onClick={() => {
                      // The form holds the last valid JSON.
                      setJsonError(null);
                      setMode("form");
                    }}
                  >
                    Form
                  </ToolButton>
                  <ToolButton
                    pressed={mode === "json"}
                    onClick={() => {
                      if (mode !== "json") setText(toJson());
                      setMode("json");
                    }}
                  >
                    JSON
                  </ToolButton>
                </Toolbar>
              </div>
            </div>
            {mode === "json" ? (
              <div className="space-y-2">
                <Label htmlFor="payload-json">
                  Paste or edit the payload JSON, or drop its file on this card
                </Label>
                <Textarea
                  id="payload-json"
                  className="mono min-h-80 text-[13px]"
                  value={text}
                  onChange={(e) => fromJson(e.target.value)}
                  spellCheck={false}
                  placeholder={
                    '{ "title": "…", "salt": "0x…", "calls": [{ "target": "0x…", "value": "0", "data": "0x…" }] }'
                  }
                  data-testid="payload-json"
                />
                {jsonError ? (
                  <p className="text-red-800 text-sm" role="alert" data-testid="payload-json-error">
                    {jsonError}
                  </p>
                ) : (
                  <p className="text-slate-600 text-xs">
                    The format signers load: salt and calls (values in wei); a title (not signed)
                    and an executor (it must be the Emergency Upgrade Board) are optional.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title (not signed, for humans)</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Fix …"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="salt">Salt</Label>
                    <div className="flex gap-2">
                      <Input
                        id="salt"
                        className="mono text-[13px]"
                        value={salt}
                        onChange={(e) => setSalt(e.target.value)}
                        spellCheck={false}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10"
                        onClick={() => setSalt(toHex(crypto.getRandomValues(new Uint8Array(32))))}
                      >
                        Random
                      </Button>
                    </div>
                  </div>
                </div>
                {calls.map((call, i) => (
                  <div
                    key={call.key}
                    id={`draft-call-${i + 1}`}
                    className={cn(
                      "scroll-mt-24 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 transition-shadow",
                      flash === i && "ring-[3px] ring-brand-600"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-slate-950 text-sm">Call {i + 1}</p>
                      {calls.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove call"
                          onClick={() => setCalls(calls.filter((_, j) => j !== i))}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                      <Input
                        className="mono text-[13px]"
                        placeholder="Target address"
                        value={call.target}
                        onChange={(e) => update(i, { target: e.target.value })}
                      />
                      <Input
                        placeholder="Value (ETH)"
                        value={call.valueEth}
                        onChange={(e) => update(i, { valueEth: e.target.value })}
                      />
                    </div>
                    <Textarea
                      className="mono min-h-20 text-[13px]"
                      placeholder="Calldata (0x…)"
                      value={call.data}
                      onChange={(e) => update(i, { data: e.target.value })}
                    />
                    <CallCheckLine line={lineOf(i)} />
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCalls([...calls, emptyCall()])}
                >
                  <Plus /> Add call
                </Button>
              </>
            )}
          </Card>
        </JsonDrop>

        {/* The form renders at once; the id and the payload need the board's address from the
            root status, and fill in once it is read. */}
        <WithStatus fallback={<PayloadPending />}>
          {({ governance }) => (
            <Payload
              board={governance.emergencyUpgradeBoard.address as Hex}
              title={title}
              salt={salt}
              calls={calls}
              executor={executor}
              error={mode === "json" ? jsonError : null}
              check={{
                busy: fetcher.state !== "idle",
                answers,
                atBlock: answers ? fetcher.data?.atBlock ?? null : null,
                calls: checked,
                changed,
              }}
              onCheck={(payloadCalls) => {
                setChecked(payloadCalls);
                fetcher.submit(
                  { calls: payloadCalls },
                  { method: "POST", encType: "application/json" }
                );
              }}
              onShowCall={showCall}
            />
          )}
        </WithStatus>
      </div>
    </div>
  );
}

function Payload({
  board,
  title,
  salt,
  calls,
  executor = null,
  error = null,
  check,
  onCheck,
  onShowCall,
}: {
  board: Hex;
  title: string;
  salt: string;
  calls: Draft[];
  /** From pasted JSON: when given, it must be the board. */
  executor?: string | null;
  /** Why the pasted JSON is not a payload: nothing is built from it. */
  error?: string | null;
  check: CheckState;
  onCheck: (calls: Checked[]) => void;
  onShowCall: (index: number) => void;
}) {
  const navigate = useNavigate();
  const built = useMemo((): Built => {
    const fail = (error: string): Built => ({ ok: false, error });
    if (error) return fail(error);
    if (executor && (!isAddress(executor) || getAddress(executor) !== getAddress(board)))
      return fail(`The executor ${executor} is not the Emergency Upgrade Board ${board}.`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(salt))
      return fail("Salt must be 32 bytes (0x + 64 hex characters).");
    const parsed = [];
    for (const [i, c] of calls.entries()) {
      if (!isAddress(c.target)) return fail(`Call ${i + 1}: target is not an address.`);
      if (!isHex(c.data) || c.data.length % 2 !== 0)
        return fail(`Call ${i + 1}: calldata must be 0x-prefixed hex bytes.`);
      let value: bigint;
      try {
        value = parseEther(c.valueEth || "0");
      } catch {
        return fail(`Call ${i + 1}: value is not a number of ETH.`);
      }
      parsed.push({ target: getAddress(c.target), value: value.toString(), data: c.data as Hex });
    }
    const id = upgradeProposalId({ calls: parsed, executor: board, salt: salt as Hex });
    const payload = { ...(title ? { title } : {}), executor: board, salt, calls: parsed };
    return { ok: true, id, payload };
  }, [calls, salt, title, board, executor, error]);
  const json = built.ok ? JSON.stringify(built.payload, null, 2) : "";

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-6">
        <p className="font-medium text-slate-950">Upgrade id</p>
        {built.ok ? (
          <Hash value={built.id} />
        ) : (
          <p className="text-red-800 text-sm">{built.error}</p>
        )}
        <p className="text-slate-600 text-xs">
          keccak256(abi.encode(calls, executor = Emergency Upgrade Board, salt)). This is what
          members sign.
        </p>
      </Card>
      <Section title="Next" className="space-y-3">
        <div className="flex flex-col gap-2">
          <Button
            disabled={!built.ok}
            onClick={() => {
              if (built.ok) {
                savePayload(built.id, built.payload);
                navigate($path("/app/emergency/:id", { id: built.id }));
              }
            }}
          >
            Continue to signing
          </Button>
          <Button
            variant="secondary"
            disabled={!built.ok}
            onClick={() => {
              const blob = new Blob([json], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `emergency-${built.ok ? built.id.slice(0, 10) : "payload"}.json`;
              a.click();
            }}
          >
            <Download /> Download payload.json
          </Button>
          <Button
            variant="ghost"
            disabled={!built.ok}
            loading={check.busy}
            onClick={() => built.ok && onCheck(built.payload.calls)}
            data-testid="check-calls"
          >
            {check.answers ? "Check again" : "Check calls via your RPC"}
          </Button>
        </div>
        {/* The answer where it was asked for: a verdict per call, each row showing its call. */}
        <CheckResults
          check={check}
          count={built.ok ? built.payload.calls.length : 0}
          onShow={onShowCall}
        />
      </Section>
      {json && (
        <div className="relative">
          <pre className="mono max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white p-3">
            {json}
          </pre>
          <CopyButton value={json} className="absolute top-2 right-2" label="Copy payload" />
        </div>
      )}
    </div>
  );
}

function PayloadPending() {
  return (
    <Card className="space-y-3 p-6" data-testid="payload-pending">
      <p className="font-medium text-slate-950">Upgrade id</p>
      <p role="status" className="text-slate-600 text-sm">
        Reading the Emergency Upgrade Board's address, the executor the id is hashed with…
      </p>
      <div aria-hidden className="h-4 w-full rounded bg-slate-100 motion-safe:animate-pulse" />
    </Card>
  );
}

type Checked = { target: string; value: string; data: string };
type CheckState = {
  busy: boolean;
  answers: DraftCallCheck[] | null;
  atBlock: string | null;
  calls: Checked[] | null;
  /** The calls were edited after the check: its answers are not about them any more. */
  changed: boolean;
};

const checkKey = (c: Checked) => `${c.target.toLowerCase()}|${c.value}|${c.data.toLowerCase()}`;

/** A call in words: its function, an ETH transfer, or its selector. */
function callLabel(c: Checked) {
  if (c.data === "0x")
    return `transfer ${c.value === "0" ? "of nothing" : `${formatEther(BigInt(c.value))} ETH`}`;
  try {
    const decoded = decodeCall({ target: c.target as Hex, value: c.value, data: c.data as Hex });
    if (decoded.decoded) return `${decoded.decoded.name}()`;
  } catch {}
  return c.data.slice(0, 10);
}

/** Under a call in the form: what the check said about it, or that it changed since. */
function CallCheckLine({ line }: { line: DraftCallCheck | "changed" | undefined }) {
  if (!line) return null;
  const base = "flex items-start gap-1.5 text-[13px]";
  if (line === "changed")
    return (
      <p className={cn(base, "text-slate-600")} data-testid="call-check-line">
        <History aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> Changed since the check
      </p>
    );
  if (line.ok === true)
    return (
      <p className={cn(base, "font-medium text-green-900")} data-testid="call-check-line">
        <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> Succeeds as an eth_call
        from the handler
      </p>
    );
  if (line.ok === false)
    return (
      <p className={cn(base, "font-medium text-red-800")} data-testid="call-check-line">
        <XCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-all">Reverts: {line.error}</span>
      </p>
    );
  return (
    <p className={cn(base, "text-amber-900")} data-testid="call-check-line">
      <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-all">Not checked: {line.skipped}</span>
    </p>
  );
}

function CheckResults({
  check,
  count,
  onShow,
}: {
  check: CheckState;
  count: number;
  onShow: (index: number) => void;
}) {
  if (check.busy)
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 text-sm"
        data-testid="call-check"
      >
        <Loader2 aria-hidden className="h-4 w-4 shrink-0 motion-safe:animate-spin" />
        Checking {count} call{count === 1 ? "" : "s"} on your RPC…
      </p>
    );
  const { answers, calls } = check;
  if (!answers || !calls) return null;
  const n = answers.length;
  const reverts = answers.filter((a) => a.ok === false).length;
  const unchecked = answers.filter((a) => a.ok === null).length;
  const look = check.changed
    ? {
        icon: History,
        tone: "border-slate-300",
        head: "bg-slate-50 text-slate-800",
        title: "Checked before your last edit",
      }
    : reverts
      ? {
          icon: XCircle,
          tone: "border-red-300",
          head: "bg-red-50 text-red-900",
          title: `${reverts} of ${n} call${n === 1 ? "" : "s"} revert${reverts === 1 ? "s" : ""}`,
        }
      : unchecked
        ? {
            icon: AlertTriangle,
            tone: "border-amber-300",
            head: "bg-amber-50 text-amber-950",
            title: `${unchecked} of ${n} call${n === 1 ? "" : "s"} could not be checked`,
          }
        : {
            icon: CheckCircle2,
            tone: "border-green-300",
            head: "bg-green-50 text-green-900",
            title: n === 1 ? "The call succeeds" : `All ${n} calls succeed`,
          };
  const Icon = look.icon;
  return (
    <div
      className={cn("overflow-hidden rounded-xl border bg-white", look.tone)}
      aria-live="polite"
      data-testid="call-check"
      data-changed={check.changed ? "true" : undefined}
    >
      <div className={cn("flex items-start gap-2 px-4 py-3", look.head)}>
        <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold text-[15px]" data-testid="call-check-title">
            {look.title}
          </p>
          <p className="text-xs opacity-90">
            {check.changed
              ? "The calls changed after it: check again for them as they are now."
              : check.atBlock
                ? `At block #${formatNumber(check.atBlock)}, each as an eth_call from the ProtocolUpgradeHandler.`
                : "At the latest block, each as an eth_call from the ProtocolUpgradeHandler."}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {answers.map((a, i) => {
          const call = calls[i];
          const word = a.ok === true ? "succeeds" : a.ok === false ? "reverts" : "not checked";
          const RowIcon = a.ok === true ? CheckCircle2 : a.ok === false ? XCircle : AlertTriangle;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: one row per call, in order
            <li key={i}>
              <button
                type="button"
                onClick={() => onShow(i)}
                className={cn(
                  "flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600 focus-visible:ring-inset",
                  check.changed && "opacity-60"
                )}
                title="Show this call"
                data-testid="call-check-row"
              >
                <RowIcon
                  aria-hidden
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    check.changed
                      ? "text-slate-500"
                      : a.ok === true
                        ? "text-green-800"
                        : a.ok === false
                          ? "text-red-800"
                          : "text-amber-800"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-[13.5px] text-navy-800">
                    Call {i + 1} ·{" "}
                    <span className="mono text-[13px]">{call ? callLabel(call) : ""}</span>
                  </span>
                  {a.ok === false && (
                    <span
                      className={cn(
                        "mono block break-all text-xs",
                        check.changed ? "text-slate-600" : "text-red-800"
                      )}
                    >
                      {a.error}
                    </span>
                  )}
                  {a.ok === null && (
                    <span
                      className={cn(
                        "block break-all text-xs",
                        check.changed ? "text-slate-600" : "text-amber-900"
                      )}
                    >
                      {a.skipped}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-slate-600 text-xs">{word}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-slate-100 border-t px-4 py-2 text-[12px] text-slate-600">
        Each call is checked on its own: one that relies on an earlier call of this upgrade can
        differ when they run in order.
      </p>
    </div>
  );
}
