import { badRequest } from "@/utils/http";
import type { z, ZodTypeAny } from "zod";

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

export type ObjectSchema = Record<string, ZodTypeAny>;

export type ParsedObject<T extends ObjectSchema> = {
  [key in keyof T]: z.infer<T[key]>;
};

export type ParsedObjectError<T extends ObjectSchema> = Partial<
  Record<keyof ParsedObject<T>, string>
>;

export type ParseFromDataRes<T extends ObjectSchema> =
  | {
      success: true;
      data: ParsedObject<T>;
      errors: null;
    }
  | {
      success: false;
      data: null;
      errors: ParsedObjectError<T>;
    };

export type ExtraValidation<T extends ObjectSchema> = {
  key: string;
  check: (o: ParsedObject<T>) => boolean;
  message: (o: ParsedObject<T>) => string;
};

export function parseFormData<T extends ObjectSchema>(
  formData: FormData,
  parser: T,
  extraValidations: ExtraValidation<T>[] = []
): ParseFromDataRes<T> {
  const keys = Object.entries(parser);

  const data: Record<string, any> = {};
  const errors: Record<string, string> = {};

  for (const [key, schema] of keys) {
    const value = formData.get(key);
    const parsed = schema.safeParse(value);

    if (parsed.success) {
      data[key] = parsed.data;
    } else {
      errors[key] = parsed.error.errors[0]
        ? parsed.error.errors[0].message
        : `Error parsing ${key}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, data: null, errors: errors as ParsedObjectError<T> };
  }

  const parsed = data as ParsedObject<T>;

  for (const extraValidation of extraValidations) {
    if (extraValidation.check(parsed)) {
      errors[extraValidation.key] = extraValidation.message(parsed);
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, data: null, errors: errors as ParsedObjectError<T> };
  }

  return { success: true, data: parsed, errors: null };
}

export type WithFormData = {
  formData: () => Promise<FormData>;
};

export async function getFormDataOrThrow<T extends ObjectSchema>(
  request: WithFormData,
  schema: T,
  error = (_e: ParsedObjectError<T>) => badRequest("Error parsing body")
): Promise<ParsedObject<T>> {
  const formData = await request.formData();
  const res = parseFormData(formData, schema);
  if (!res.success) {
    throw error(res.errors);
  }

  return res.data;
}

export function extractFromParams<T extends ZodTypeAny>(
  params: Record<string, string | undefined>,
  schema: T,
  error = badRequest("Invalid query params")
): z.infer<typeof schema> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw error;
  }
  return parsed.data;
}
