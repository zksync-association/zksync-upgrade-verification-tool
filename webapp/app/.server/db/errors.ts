import postgres from "postgres";

export function isUniqueConstraintError(err: unknown) {
  return err instanceof postgres.PostgresError && err.code === "23505";
}
