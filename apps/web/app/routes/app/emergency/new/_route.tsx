import { type DraftCallCheck, checkDraftCalls } from "@/.server/flows/emergency-draft";
import { upgradeProposalId } from "@/common/proposal";
import { useStatus } from "@/components/app-shell";
import { CopyButton, Hash } from "@/components/hex";
import { PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { badRequest } from "@/utils/http";
import { Meta } from "@/utils/meta";
import { savePayload } from "@/utils/payload-storage";
import { type ActionFunctionArgs, json } from "@remix-run/node";
import { useFetcher, useNavigate } from "@remix-run/react";
import { Download, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { $path } from "remix-routes";
import { type Hex, getAddress, isAddress, isHex, parseEther, toHex } from "viem";
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
  const results: DraftCallCheck[] = await checkDraftCalls(
    body.data.calls.map((call) => ({
      target: getAddress(call.target),
      value: BigInt(call.value),
      data: call.data as Hex,
    }))
  );
  return json({ results });
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

export default function NewEmergency() {
  const { governance } = useStatus();
  const board = governance.emergencyUpgradeBoard.address as Hex;
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const [title, setTitle] = useState("");
  const [salt, setSalt] = useState<string>(`0x${"0".repeat(64)}`);
  const [calls, setCalls] = useState<Draft[]>(() => [emptyCall()]);

  const built = useMemo((): Built => {
    const fail = (error: string): Built => ({ ok: false, error });
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
  }, [calls, salt, title, board]);

  const json = built.ok ? JSON.stringify(built.payload, null, 2) : "";
  const update = (i: number, patch: Partial<Draft>) =>
    setCalls(calls.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ to: $path("/app/emergency"), label: "Emergency upgrades" }}
        eyebrow="Emergency upgrade"
        title="Prepare an emergency upgrade"
      >
        <p className="max-w-3xl text-slate-950">
          Build the payload, share the JSON with every signer through your usual private channel,
          then sign its id from your Safe. Safe only ever stores the id; signers check the payload
          against it themselves.
        </p>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="space-y-5 p-6">
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
                  className="mono text-[12px]"
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
              className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
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
                  className="mono text-[12px]"
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
                className="mono min-h-20 text-[12px]"
                placeholder="Calldata (0x…)"
                value={call.data}
                onChange={(e) => update(i, { data: e.target.value })}
              />
              <DraftCheckLine result={fetcher.data?.results[i]} />
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setCalls([...calls, emptyCall()])}>
            <Plus /> Add call
          </Button>
        </Card>

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
                loading={fetcher.state !== "idle"}
                onClick={() =>
                  built.ok &&
                  fetcher.submit(
                    { calls: built.payload.calls },
                    { method: "POST", encType: "application/json" }
                  )
                }
              >
                Check calls via your RPC
              </Button>
            </div>
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
      </div>
    </div>
  );
}

function DraftCheckLine({ result }: { result: DraftCallCheck | undefined }) {
  if (!result) return null;
  if (result.ok === true)
    return <p className="text-green-900 text-xs">eth_call from the handler succeeds</p>;
  if (result.ok === false)
    return (
      <p className="text-red-800 text-xs">eth_call from the handler reverts: {result.error}</p>
    );
  return <p className="text-amber-800 text-xs">Could not check this call: {result.skipped}</p>;
}
