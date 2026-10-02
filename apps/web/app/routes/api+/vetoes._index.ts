import { listL2Vetoes } from "@/.server/flows/l2-veto";
import { respond } from "@/.server/api";

export const loader = () => respond(listL2Vetoes);
