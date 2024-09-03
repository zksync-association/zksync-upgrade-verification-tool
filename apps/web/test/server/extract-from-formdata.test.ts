import { parseFormData } from "@/utils/read-from-request";
import { z } from "zod";
import { describe, it, expect } from "vitest";

describe("extractMany", () => {
  it("can extract from a simple form data", () => {
    const formData = new FormData();
    formData.set("foo", "bar");

    const data = parseFormData(formData, { foo: z.string() });
    expect(data.success).toBe(true);
    expect(data.errors).toBe(null);
    expect(data.data).toEqual({ foo: "bar" });
  });

  it("ignores data that is not defined in the parsers", () => {
    const formData = new FormData();
    formData.set("shouldRead", "true");
    formData.set("ignorePlease", "ok");

    const data = parseFormData(formData, { shouldRead: z.coerce.boolean() });
    expect(data.success).toBe(true);
    expect(data.errors).toBe(null);
    expect(data.data).toEqual({ shouldRead: true });
  });

  it("fails if a required field is not present", () => {
    const formData = new FormData();
    formData.set("foo", "bar");

    const data = parseFormData(formData, { foo: z.string(), requiredField: z.string() });
    if (data.errors === null) {
      return expect.fail("Errors should not be null");
    }

    expect(data.success).toBe(false);
    expect(Object.keys(data.errors)).toHaveLength(1);
    expect(data.errors.requiredField).toEqual("Expected string, received null");
    expect(data.data).toBe(null);
  });

  it("fails if a field cannot be parsed", () => {
    const formData = new FormData();
    formData.set("foo", "bar");

    const data = parseFormData(formData, { foo: z.coerce.number() });
    if (data.errors === null) {
      return expect.fail("Errors should not be null");
    }

    expect(data.success).toEqual(false);
    expect(Object.keys(data.errors)).toHaveLength(1);
    expect(data.errors.foo).toEqual("Expected number, received nan");
    expect(data.data).toEqual(null);
  });

  it("accepts optional values (using nullable)", () => {
    const formData = new FormData();
    formData.set("foo", "bar");

    const data = parseFormData(formData, { foo: z.string(), opt: z.string().nullable() });
    expect(data.success).toBe(true);
    expect(data.errors).toBe(null);
    expect(data.data).toEqual({
      foo: "bar",
      opt: null,
    });
  });
});
