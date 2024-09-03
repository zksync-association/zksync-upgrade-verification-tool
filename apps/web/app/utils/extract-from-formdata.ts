import { badRequest } from "@/utils/http";
import type { ZodTypeAny, z, ZodError, ZodObject } from "zod";

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

export type ParseFromDataRes<T extends ZodObject<any>> =
  | {
      success: true;
      data: z.infer<T>;
      error: null;
    }
  | {
      success: false;
      data: null;
      error: ZodError;
    };

export function parseFormData<T extends ZodObject<any>>(
  formData: FormData,
  parser: T
): ParseFromDataRes<T> {
  const keys = Object.keys(parser.shape);

  const data: Record<string, any> = {};

  for (const key of keys) {
    data[key] = formData.get(key);
  }

  const parsed = parser.safeParse(data);

  if (!parsed.success) {
    return { success: false, data: null, error: parsed.error };
  }

  return { success: true, data: parsed.data, error: null };
}

export type WithFormData = {
  formData: () => Promise<FormData>;
};

export async function extractFromFormData<T extends ZodObject<any>>(
  request: WithFormData,
  schema: T,
  error = badRequest("Error parsing body")
): Promise<z.infer<T>> {
  const formData = await request.formData();
  const res = parseFormData(formData, schema);
  if (!res.success) {
    throw error;
  }

  return res.data;
}
