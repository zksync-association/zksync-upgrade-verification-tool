import postgres from "postgres";

export function isUniqueConstraintError(err: unknown) {
  return err instanceof postgres.PostgresError && err.code === "23505";
}

export class ValidationError extends Error {}

export function isValidationError(error: any): boolean {
  return error instanceof ValidationError;
}
