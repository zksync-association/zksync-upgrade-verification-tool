import { loadChainUpgrade, prepareChainUpgrade } from "@/.server/flows/chain-upgrade";
import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { getAddress, type Hex } from "viem";
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const q = new URL(request.url).searchParams;
    const chainId = q.get("chainId") ?? "";
    if (!/^\d{1,20}$/.test(chainId)) throw new Error("Enter a valid chain ID.");
    const action = q.get("action");
    if (!action)
      return json(
        { state: (await loadChainUpgrade(BigInt(chainId))).state },
        { headers: { "Cache-Control": "no-store" } }
      );
    if (action !== "timestamp" && action !== "execute")
      throw new Error("Unknown chain upgrade action.");
    const timestamp = q.get("timestamp");
    if (timestamp !== null && !/^\d{1,20}$/.test(timestamp)) throw new Error("Invalid timestamp.");
    const hash = q.get("hash");
    if (hash !== null && !/^0x[0-9a-fA-F]{64}$/.test(hash))
      throw new Error("Invalid transaction hash.");
    const plan = await prepareChainUpgrade(
      BigInt(chainId),
      action,
      getAddress(q.get("owner") ?? ""),
      timestamp === null ? undefined : BigInt(timestamp),
      (hash ?? undefined) as Hex | undefined
    );
    return json({ state: plan.state, plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
