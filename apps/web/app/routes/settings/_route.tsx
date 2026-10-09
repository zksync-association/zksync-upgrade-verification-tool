import { prewarm } from "@/.server/prewarm";
import { requireLocalSettings, settingsSummary, updateSettings } from "@/.server/settings";
import { startSync } from "@/.server/sync/engine";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useRef } from "react";

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
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Settings">
        Configure data sources for this local verifier. Changes apply to all tabs and are saved on
        this computer.
      </PageHeader>
      <Form
        method="post"
        ref={form}
        className="space-y-6 rounded-xl border border-slate-300 bg-white p-5 sm:p-6"
        autoComplete="off"
      >
        <p className="text-slate-700 text-sm">
          Leave a field blank to keep its current value. Saved keys and complete RPC URLs are never
          displayed.
        </p>
        <div className="space-y-2">
          <label htmlFor="l1Rpc" className="block font-semibold text-navy-800">
            Ethereum L1 RPC
          </label>
          <p id="l1-hint" className="text-slate-700 text-sm">
            Current provider: {settings.l1Host}. Use Ethereum Mainnet or Sepolia with log history.
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
          <p id="l2-hint" className="text-slate-700 text-sm">
            {settings.l2Host
              ? `Custom provider: ${settings.l2Host}.`
              : "Using the network's default provider."}{" "}
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
          <p id="safe-hint" className="text-slate-700 text-sm">
            {settings.safeKeyConfigured ? "A key is configured." : "No key configured."} This is the
            Safe Transaction Service API key, not a wallet private key or recovery phrase.
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
