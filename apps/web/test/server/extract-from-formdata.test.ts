import { parseFormData } from "@/utils/extract-from-formdata";
import { z } from "zod";
import { describe, it, expect } from "vitest";

describe('extractMany', () => {
  it("can extract from a simple form data", () => {
    const formData = new FormData()
    formData.set("foo", "bar")

    const data = parseFormData(formData, { foo: z.string() })
    expect(data.success).toEqual(true)
    expect(data.errors).toEqual([])
    expect(data.data).toEqual({ foo: "bar"})
  })

  it("ignores data that is not defined in the parsers", () => {
    const formData = new FormData()
    formData.set("shouldRead", "true")
    formData.set("ignorePlease", "ok")

    const data = parseFormData(formData, { shouldRead: z.coerce.boolean() })
    expect(data.success).toEqual(true)
    expect(data.errors).toEqual([])
    expect(data.data).toEqual({ shouldRead: true})
  })

  it("fails if a required field is not present", () => {
    const formData = new FormData()
    formData.set("foo", "bar")

    const data = parseFormData(formData, { foo: z.string(), requiredField: z.string() })
    expect(data.success).toEqual(false)
    expect(data.errors).toHaveLength(1)
    expect(data.data).toEqual(null)
  })

  it("fails if a field cannot be parsed", () => {
    const formData = new FormData()
    formData.set("foo", "bar")

    const data = parseFormData(formData, { foo: z.coerce.number() })
    expect(data.success).toEqual(false)
    expect(data.errors).toHaveLength(1)
    expect(data.data).toEqual(null)
  })

  it("accepts optional values (using nullable)", () => {
    const formData = new FormData()
    formData.set("foo", "bar")

    const data = parseFormData(formData, { foo: z.string(), opt: z.string().nullable() })
    expect(data.success).toBe(true)
    expect(data.errors).toHaveLength(0)
    expect(data.data).toEqual({
      foo: "bar",
      opt: null
    })
  })

  it("accepts optional values (using nullable)", () => {
    const formData = new FormData()
    formData.set("foo", "bar")

    const data = parseFormData(formData, { foo: z.string(), opt: z.string().nullable() })
    expect(data.success).toBe(true)
    expect(data.errors).toHaveLength(0)
    expect(data.data).toEqual({
      foo: "bar",
      opt: null
    })
  })
});
