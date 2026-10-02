import { listEmergencyUpgrades } from "@/.server/flows/emergency";
import { respond } from "@/.server/api";

export const loader = () => respond(listEmergencyUpgrades);
