export type Environment = "development" | "production";

export const ENVIRONMENT: Environment =
  (process.env.ENVIRONMENT?.toLowerCase() as Environment) ||
  (process.env.NODE_ENV === "production" ? "production" : "development");
