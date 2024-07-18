/// <reference types="vitest" />
/// <reference types="vite/client" />
/// <reference types="@remix-run/node" />

import type * as integration from "./app/test/factory";

declare module "vitest" {
  export interface TestContext {
    integration: typeof integration;
    request: Request;
  }
}
