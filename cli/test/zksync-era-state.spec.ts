import { describe, it, expect } from "vitest";
import { ZkSyncEraState } from "../src/lib/index";
import { CurrentZksyncEraState } from "../src/lib/current-zksync-era-state";

describe("ZkSyncEraState", () => {
  it("", () => {
    const state = new CurrentZksyncEraState();
    expect(1).toEqual(1);
  });
});
