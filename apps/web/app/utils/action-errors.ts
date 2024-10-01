export function formError<T>(errors: T) {
  return {
    error_type: FORM_ERROR,
    errors,
  };
}

export function generalError<T>(error: T) {
  return {
    error_type: GENERAL_ERROR,
    error,
  };
}

export const FORM_ERROR = "form_error" as const;
export const GENERAL_ERROR = "general_error" as const;
