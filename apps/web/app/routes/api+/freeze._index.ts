import { listFreezeRequests } from "@/.server/flows/freeze";
import { respond } from "@/.server/api";

export const loader = () => respond(listFreezeRequests);
