import { prepareSafeOwnerApproval } from "@/.server/safe-owner-approval";
import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { type Hex, getAddress } from "viem";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const query = new URL(request.url).searchParams;
    const id = query.get("id") ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error("Invalid upgrade ID.");
    const plan = await prepareSafeOwnerApproval(
      id as Hex,
      getAddress(query.get("safe") ?? ""),
      getAddress(query.get("owner") ?? "")
    );
    return json({ plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (_error) {
    return json(
      { error: _error instanceof Error ? _error.message : String(_error) },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
