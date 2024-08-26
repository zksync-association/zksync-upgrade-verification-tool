import logger from "pino";

import { env } from "@config/env.server";

export const defaultLogger = logger({ level: env.LOG_LEVEL ?? "info" });
