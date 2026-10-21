import { prewarm } from "@/.server/prewarm";
import { requireLocalSettings, settingsSummary, updateSettings } from "@/.server/settings";
import { startSync } from "@/.server/sync/engine";
import { ExternalAnchor } from "@/components/hex";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { maskSaved } from "@/utils/mask-saved";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export function loader({ request }: LoaderFunctionArgs) {
  requireLocalSettings(request);
  return json(settingsSummary(), { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  requireLocalSettings(request);
  try {
    await updateSettings(await request.formData());
    // Warm the new data sources in the background (never rejects; PREWARM=0 turns it off), and
    // follow the head through them: the old settings' engine is retired, its reads dropped.
    void prewarm("settings");
    startSync();
    return json({ saved: true, error: null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json(
      {
        saved: false,
        error: error instanceof Error ? error.message : "Settings could not be saved.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export default function SettingsPage() {
  const settings = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const form = useRef<HTMLFormElement>(null);
  const [optionalOpen, setOptionalOpen] = useState(false);
  useEffect(() => {
    if (result?.saved) form.current?.reset();
    if (result?.error && /WalletConnect|L2 RPC/.test(result.error)) setOptionalOpen(true);
  }, [result]);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings">
        <p className="max-w-[600px] text-[14px] text-slate-550">
          Configure data sources for this local verifier. Changes apply to all tabs and are saved on
          this computer.
        </p>
      </PageHeader>
      <Form method="post" ref={form} className="space-y-5" autoComplete="off">
        <section
          className="space-y-6 rounded-xl border border-slate-300 bg-white p-5 sm:p-6"
          aria-labelledby="sources-heading"
        >
          <div className="space-y-1">
            <h2 id="sources-heading" className="font-semibold text-lg text-navy-800">
              Data sources
            </h2>
            <p className="text-slate-600 text-sm">
              Leave a field blank to keep its saved value. Saved values stay hidden until you press
              Show.
            </p>
          </div>
          <Setting
            htmlFor="l1Rpc"
            title="Ethereum L1 RPC"
            state={
              settings.l1Rpc ? <Pill tone="set">Saved</Pill> : <Pill tone="needed">Required</Pill>
            }
          >
            {settings.l1Rpc && <SavedValue value={settings.l1Rpc} kind="url" name="L1 RPC" />}
            <p id="l1-hint" className="text-slate-700 text-sm">
              Ethereum Mainnet or Sepolia, with log history. We recommend your own endpoint from{" "}
              <ExternalAnchor href="https://www.infura.io/">Infura</ExternalAnchor> or{" "}
              <ExternalAnchor href="https://www.alchemy.com/">Alchemy</ExternalAnchor>.
            </p>
            <Input
              id="l1Rpc"
              name="l1Rpc"
              type="password"
              placeholder={settings.l1Rpc ? "Another L1 RPC URL" : "L1 RPC URL"}
              aria-describedby="l1-hint"
            />
          </Setting>
          <Setting
            htmlFor="safeKey"
            title="Safe API key"
            state={
              settings.safeKey ? (
                <Pill tone="set">Saved</Pill>
              ) : (
                <Pill tone="neutral">Recommended</Pill>
              )
            }
          >
            {settings.safeKey && (
              <SavedValue value={settings.safeKey} kind="key" name="Safe API key" />
            )}
            <p id="safe-hint" className="text-slate-700 text-sm">
              Lifts Safe's limits (2 requests a second, 5,000 a month without one), so signatures
              are checked faster. It is the Safe Transaction Service API key, not a wallet private
              key or recovery phrase.
            </p>
            <p className="text-slate-700 text-sm" data-testid="safe-key-source">
              Get one in Safe's developer dashboard, under API Keys:{" "}
              <ExternalAnchor href="https://developer.safe.global/">
                developer.safe.global
              </ExternalAnchor>
            </p>
            <Input
              id="safeKey"
              name="safeKey"
              type="password"
              placeholder={settings.safeKey ? "Another Safe API key" : "Safe API key"}
              aria-describedby="safe-hint"
            />
            {settings.safeKey && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="clearSafeKey" /> Remove the API key
              </label>
            )}
          </Setting>
        </section>

        {/* Works as it is: folded, its state said in the summary. */}
        <details
          className="group rounded-xl border border-slate-300 bg-white"
          open={optionalOpen}
          onToggle={(e) => setOptionalOpen(e.currentTarget.open)}
          data-testid="optional-settings"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 space-y-0.5">
              <span className="block font-semibold text-lg text-navy-800">Optional</span>
              <span className="block text-slate-600 text-sm" data-testid="optional-summary">
                {settings.l2Rpc || settings.wcProjectId
                  ? `ZKsync L2 RPC: ${settings.l2Rpc ? "your own" : "default provider"} · WalletConnect: ${settings.wcProjectId ? "your own project id" : "built-in project id"}`
                  : "Nothing to set: ZKsync L2 RPC uses the network's default provider, WalletConnect the app's built-in project id."}
              </span>
            </span>
            <ChevronDown
              aria-hidden
              className="h-5 w-5 shrink-0 text-slate-600 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="space-y-6 border-slate-200 border-t px-5 py-5 sm:px-6">
            <Setting
              htmlFor="l2Rpc"
              title="ZKsync L2 RPC"
              state={
                settings.l2Rpc ? (
                  <Pill tone="own">Your own</Pill>
                ) : (
                  <Pill tone="default">Default provider</Pill>
                )
              }
            >
              {settings.l2Rpc && <SavedValue value={settings.l2Rpc} kind="url" name="L2 RPC" />}
              <p id="l2-hint" className="text-slate-700 text-sm">
                {settings.l2Rpc
                  ? "Used instead of the network's default provider. It must match the L1 network."
                  : "The network's default provider is used. To use your own, paste its URL; it must match the L1 network."}
              </p>
              <Input
                id="l2Rpc"
                name="l2Rpc"
                type="password"
                placeholder={settings.l2Rpc ? "Another L2 RPC URL" : "Your L2 RPC URL"}
                aria-describedby="l2-hint"
              />
              {settings.l2Rpc && (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="clearL2Rpc" /> Go back to the default provider
                </label>
              )}
            </Setting>
            <Setting
              htmlFor="wcProjectId"
              title="WalletConnect project id"
              state={
                settings.wcProjectId ? (
                  <Pill tone="own">Your own</Pill>
                ) : (
                  <Pill tone="default">Built in</Pill>
                )
              }
            >
              {settings.wcProjectId && (
                <SavedValue
                  value={settings.wcProjectId}
                  kind="key"
                  name="WalletConnect project id"
                />
              )}
              <p id="wc-hint" className="text-slate-700 text-sm">
                {settings.wcProjectId
                  ? "Used instead of the app's built-in project id."
                  : "The app's built-in project id is used: it lets you connect your Safe from Safe{Wallet} to sign, or a wallet app to send. Only with a project of your own on Reown (dashboard.reown.com), paste its id."}
              </p>
              <Input
                id="wcProjectId"
                name="wcProjectId"
                placeholder={
                  settings.wcProjectId
                    ? "Another WalletConnect project id"
                    : "Your WalletConnect project id"
                }
                aria-describedby="wc-hint"
              />
              {settings.wcProjectId && (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="clearWcProjectId" /> Go back to the built-in project
                  id
                </label>
              )}
            </Setting>
          </div>
        </details>

        {result?.error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900 text-sm">
            {result.error}
          </p>
        )}
        {result?.saved && (
          <p role="status" className="rounded-lg bg-green-50 p-3 text-green-900 text-sm">
            Settings saved. Data sources and verification caches have been refreshed.
          </p>
        )}
        <Button type="submit" loading={navigation.state === "submitting"}>
          Save settings
        </Button>
      </Form>
    </div>
  );
}

/** One setting: its name and, beside it, where it stands (required, saved, built in…). */
function Setting({
  htmlFor,
  title,
  state,
  children,
}: {
  htmlFor: string;
  title: string;
  state: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={htmlFor} className="font-semibold text-navy-800">
          {title}
        </label>
        {state}
      </div>
      {children}
    </div>
  );
}

const PILL_TONES = {
  needed: "border-amber-300 bg-amber-50 text-amber-950",
  neutral: "border-slate-300 bg-slate-50 text-slate-700",
  set: "border-green-300 bg-green-50 text-green-900",
  default: "border-green-300 bg-green-50 text-green-900",
  own: "border-navy-200 bg-navy-50 text-navy-800",
} as const;

function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-medium text-xs ${PILL_TONES[tone]}`}
    >
      {(tone === "set" || tone === "default") && <Check aria-hidden className="h-3 w-3" />}
      {children}
    </span>
  );
}

function SavedValue({
  value,
  kind,
  name,
}: {
  value: string;
  kind: "url" | "key";
  name: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1 pr-1 pl-3">
      <code
        className="mono min-w-0 flex-1 break-all text-[13px] text-slate-950"
        data-testid="saved-value"
        data-shown={shown ? "true" : "false"}
      >
        {shown ? value : maskSaved(value, kind)}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="border-transparent bg-transparent hover:border-transparent"
        aria-pressed={shown}
        aria-label={`${shown ? "Hide" : "Show"} the saved ${name}`}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? <EyeOff /> : <Eye />}
        {shown ? "Hide" : "Show"}
      </Button>
    </div>
  );
}
