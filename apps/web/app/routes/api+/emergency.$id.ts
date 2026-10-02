import { getEmergencyUpgrade } from "@/.server/flows/emergency";
import { parseId } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { emergencyExecution } from "@/common/execution";
import { checkEmergencyPayload } from "@/common/proposal";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { Hex } from "viem";
import { respond } from "@/.server/api";

export const loader = ({ params, request }: LoaderFunctionArgs) =>
  respond(() => getEmergencyUpgrade(parseId(params.id), { supplied: suppliedSignatures(request) }));

// POST the payload JSON to check it against the id and get the execution calldata once every
// group has reached its threshold. (The browser UI does this client-side instead.)
export const action = ({ params, request }: ActionFunctionArgs) =>
  respond(async () => {
    const id = parseId(params.id);
    const [detail, payload] = await Promise.all([
      getEmergencyUpgrade(id, { supplied: suppliedSignatures(request) }),
      request.json().catch(() => null),
    ]);
    const board = detail.governance.emergencyUpgradeBoard;
    const check = checkEmergencyPayload(payload, id, board.address);
    const valid = (key: string) => detail.roles.find((r) => r.key === key)?.set.valid ?? [];
    const ready = check.ok && detail.roles.every((r) => r.set.thresholdCheck.status === "met");
    const zkf = valid("zkFoundation")[0];
    return {
      check,
      execution:
        check.ok && ready && zkf
          ? emergencyExecution(
              board.address,
              check.proposal,
              valid("guardians"),
              valid("securityCouncil"),
              zkf.signature as Hex
            )
          : null,
    };
  });
