import { badRequest } from "@/utils/http";
import type { ZodTypeAny, z, ZodError } from "zod";

export function extract<T extends ZodTypeAny>(
  formData: FormData,
  key: string,
  parser: T
): z.infer<typeof parser> {
  const value = formData.get(key);
  const parsed = parser.safeParse(value);
  if (parsed.error) {
    throw badRequest(`Wrong value for ${key}`);
  }
  return parsed.data;
}

export type PlainObjectSchema = {
  [key: string]: ZodTypeAny;
};

export type ParsedPlainObject<T extends PlainObjectSchema> = {
  [K in keyof T]: z.infer<T[K]>;
};

export type ParseFromDataRes<T extends PlainObjectSchema> =
  | {
      success: true;
      data: ParsedPlainObject<T>;
      errors: [];
    }
  | {
      success: false;
      data: null;
      errors: ZodError[];
    };

export function parseFormData<T extends PlainObjectSchema>(
  formData: FormData,
  parser: T
): ParseFromDataRes<T> {
  const keys = Object.entries(parser);
  const res: any = {};
  const errors: ZodError[] = [];

  for (const [key, schema] of keys) {
    const data = formData.get(key);
    const parsed = schema.safeParse(data);
    if (parsed.success) {
      res[key] = parsed.data;
    } else {
      errors.push(parsed.error);
    }
  }

  if (errors.length > 0) {
    return { success: false, data: null, errors: errors };
  }

  return { success: true, data: res as ParsedPlainObject<T>, errors: [] };
}

export type WithFormData = {
  formData: () => Promise<FormData>;
};

export async function extractFromFormData<T extends PlainObjectSchema>(
  request: WithFormData,
  schema: T,
  error = badRequest("Error parsing body")
): Promise<ParsedPlainObject<T>> {
  const formData = await request.formData();
  const res = parseFormData(formData, schema);
  if (!res.success) {
    throw error;
  }

  return res.data;
}
