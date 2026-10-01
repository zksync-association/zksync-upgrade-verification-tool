import { UpgradeNotFound } from "@/.server/flows/standard";
import { json } from "@remix-run/node";

// JSON for scripts and agents: the same flow functions as the pages, unformatted.
export async function respond<T>(work: () => Promise<T>) {
  try {
    return json(await work(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof UpgradeNotFound) return json({ error: error.message }, { status: 404 });
    return json(
      { error: error instanceof Error ? error.message.split("\n")[0] : String(error) },
      { status: 502 }
    );
  }
}
