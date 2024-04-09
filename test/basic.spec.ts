import { describe, expect, it } from "vitest";

describe("Basic Suite", () => {
  it("should pass", () => {
    expect(true).toBeTruthy();
  });

  it("should fail", () => {
    const a = "a";
    expect(a).not.toContainEqual("b");
  });

  describe("Nested Suite", () => {
    it("should pass", () => {
      expect(true).toBeTruthy();
    });

    it("should fail", () => {
      const a = "a";
      expect(a).not.toContainEqual("b");
    });
  });
});
