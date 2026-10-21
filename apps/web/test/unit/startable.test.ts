import { MAX_STARTABLE_DAYS, STARTABLE_DAYS, startableDays } from "@/common/startable";
import { describe, expect, it } from "vitest";

describe("startableDays", () => {
  it("is the page's ?days, in whole days, at most ten years", () => {
    expect(startableDays("90")).toBe(90);
    expect(startableDays("1")).toBe(1);
    expect(startableDays("100000")).toBe(MAX_STARTABLE_DAYS);
  });

  it("falls back to 30 days for anything else", () => {
    for (const raw of [null, "", "0", "-5", "1.5", "abc", "1e3x"])
      expect(startableDays(raw)).toBe(STARTABLE_DAYS);
  });
});
