import { parseFormData } from "@/utils/extract-from-formdata";
import { z } from "zod";
import { describe, it, expect } from "vitest";

describe("extractMany", () => {
  it("can extract from a simple form data", () => {
    const formData = new FormData();
    formData.set("foo", "bar");

    const data = parseFormData(formData, z.object({ foo: z.string() }));
    expect(data.success).toBe(true);
    expect(data.error).toBe(null);
    expect(data.data).toEqual({ foo: "bar" });
  });

  it("ignores data that is not defined in the parsers", () => {
    const formData = new FormData();
    formData.set("shouldRead", "true");
    formData.set("ignorePlease", "ok");

    const data = parseFormData(formData, z.object({ shouldRead: z.coerce.boolean() }));
    expect(data.success).toBe(true);
    expect(data.error).toBe(null);
    expect(data.data).toEqual({ shouldRead: true });
  });

  it("fails if a required field is not present", () => {
    const formData = new FormData();
    formData.set("foo", "bar");

    const data = parseFormData(formData, z.object({ foo: z.string(), requiredField: z.string() }));
    expect(data.success).toBe(false);
    expect(data.error).not.toBe(null);
    expect(data.error?.errors).toHaveLength(1);
    expect(data.error?.errors[0]?.path).toEqual(["requiredField"]);
    expect(data.data).toBe(null);
  });

  it("fails if a field cannot be parsed", () => {
    const formData = new FormData();
    formData.set("foo", "bar");

    const data = parseFormData(formData, z.object({ foo: z.coerce.number() }));
    expect(data.success).toEqual(false);
    expect(data.error).not.toBe(null);
    expect(data.error?.errors).toHaveLength(1);
    expect(data.error?.errors[0]?.path).toEqual(["foo"]);
    expect(data.data).toEqual(null);
  });

  it("accepts optional values (using nullable)", () => {
    const formData = new FormData();
    formData.set("foo", "bar");

    const data = parseFormData(formData, z.object({ foo: z.string(), opt: z.string().nullable() }));
    expect(data.success).toBe(true);
    expect(data.error).toBe(null);
    expect(data.data).toEqual({
      foo: "bar",
      opt: null,
    });
  });
});
