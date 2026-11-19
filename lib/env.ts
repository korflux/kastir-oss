import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().refine((url) => url.startsWith("redis"), {
    message: "REDIS_URL must use redis:// or rediss://",
  }),
  NEXTAUTH_SECRET: z.string().min(32),
  /** Public origin used by Better Auth for cookies, CSRF and redirects. */
  BETTER_AUTH_URL: z.url(),
  /** Confidential resource-server credentials used for MCP introspection. */
  MCP_INTROSPECTION_CLIENT_ID: optionalNonEmptyString,
  MCP_INTROSPECTION_CLIENT_SECRET: optionalNonEmptyString,
  /**
   * When true, rate limiting may use X-Forwarded-For / X-Real-IP.
   * Enable only behind a trusted reverse proxy that overwrites those headers.
   */
  AUTH_TRUST_PROXY: booleanFromString.default(false),
  MASTER_EMAIL: z.email(),
  MASTER_PASSWORD: z.string().min(8),
  MASTER_FORCE_RESET: booleanFromString.default(false),
  SITE_TITLE: z.string().optional(),
  PANEL_LANGUAGE: z.string().default("en"),
});

export const env = envSchema.parse(process.env);
