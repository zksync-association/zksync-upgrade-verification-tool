import { appStatus } from "@/.server/status";
import { respond } from "@/.server/api";

export const loader = () => respond(() => appStatus());
