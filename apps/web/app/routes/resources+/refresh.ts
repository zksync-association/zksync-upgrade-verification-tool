import { clearCache, invalidate } from "@/.server/cache";
import { network } from "@/.server/rpc";
import { refreshSafeData } from "@/.server/safe-api";
import { json } from "@remix-run/node";

// Drops cached Safe answers and governance state so the next load re-fetches them. On a local
// dev node (which can be rewound at will) everything is dropped.
export async function action() {
  const net = await network();
  if (net.isDevNode) {
    clearCache();
    return json({ refreshed: true });
  }
  const refreshed = refreshSafeData();
  invalidate("governance");
  invalidate("latest-block");
  return json({ refreshed });
}
