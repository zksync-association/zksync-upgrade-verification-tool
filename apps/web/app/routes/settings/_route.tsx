import { prewarm } from "@/.server/prewarm";
import { requireLocalSettings, settingsSummary, updateSettings } from "@/.server/settings";
import { startSync } from "@/.server/sync/engine";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { maskSaved } from "@/utils/mask-saved";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  useEffect(() => {
    if (result?.saved) form.current?.reset();
  }, [result]);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings">
        <p className="max-w-[600px] text-[14px] text-slate-550">
          Configure data sources for this local verifier. Changes apply to all tabs and are saved on
          this computer.
        </p>
      </PageHeader>
      <Form
        method="post"
        ref={form}
        className="space-y-6 rounded-xl border border-slate-300 bg-white p-5 sm:p-6"
        autoComplete="off"
      >
        <p className="text-slate-700 text-sm">
          Leave a field blank to keep its saved value. Saved values stay hidden until you press
          Show.
        </p>
        <div className="space-y-2">
          <label htmlFor="l1Rpc" className="block font-semibold text-navy-800">
            Ethereum L1 RPC
          </label>
          <SavedValue value={settings.l1Rpc} kind="url" name="L1 RPC" empty="No RPC saved yet." />
          <p id="l1-hint" className="text-slate-700 text-sm">
            Use Ethereum Mainnet or Sepolia with log history.
          </p>
          <Input
            id="l1Rpc"
            name="l1Rpc"
            type="password"
            placeholder="New L1 RPC URL"
            aria-describedby="l1-hint"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="l2Rpc" className="block font-semibold text-navy-800">
            ZKsync L2 RPC
          </label>
          <SavedValue
            value={settings.l2Rpc}
            kind="url"
            name="L2 RPC"
            empty="None saved: using the network's default provider."
          />
          <p id="l2-hint" className="text-slate-700 text-sm">
            Must match the L1 network.
          </p>
          <Input
            id="l2Rpc"
            name="l2Rpc"
            type="password"
            placeholder="New L2 RPC URL (optional)"
            aria-describedby="l2-hint"
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="clearL2Rpc" /> Use the default L2 provider
          </label>
        </div>
        <div className="space-y-2">
          <label htmlFor="safeKey" className="block font-semibold text-navy-800">
            Safe API key
          </label>
          <SavedValue
            value={settings.safeKey}
            kind="key"
            name="Safe API key"
            empty="No key saved."
          />
          <p id="safe-hint" className="text-slate-700 text-sm">
            This is the Safe Transaction Service API key, not a wallet private key or recovery
            phrase.
          </p>
          <Input
            id="safeKey"
            name="safeKey"
            type="password"
            placeholder="New Safe API key"
            aria-describedby="safe-hint"
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="clearSafeKey" /> Remove the API key
          </label>
        </div>
        <div className="space-y-2">
          <label htmlFor="wcProjectId" className="block font-semibold text-navy-800">
            WalletConnect project id
          </label>
          <SavedValue
            value={settings.wcProjectId}
            kind="key"
            name="WalletConnect project id"
            empty="None saved: using the app's built-in project id."
          />
          <p id="wc-hint" className="text-slate-700 text-sm">
            Optional. WalletConnect lets you connect your member Safe in Safe{"{"}Wallet{"}"} to
            sign, or a wallet app to send a transaction. To use a project of your own, paste its id
            from Reown (dashboard.reown.com).
          </p>
          <Input
            id="wcProjectId"
            name="wcProjectId"
            placeholder="New WalletConnect project id"
            aria-describedby="wc-hint"
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="clearWcProjectId" /> Use the built-in project id
          </label>
        </div>
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

function SavedValue({
  value,
  kind,
  name,
  empty,
}: {
  value: string | null;
  kind: "url" | "key";
  name: string;
  empty: string;
}) {
  const [shown, setShown] = useState(false);
  if (!value) return <p className="text-slate-700 text-sm">{empty}</p>;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1 pr-1 pl-3">
      <span className="shrink-0 text-slate-600 text-xs">Saved</span>
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
