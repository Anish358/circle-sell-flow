import { z } from "zod"

/**
 * Every environment variable the server needs, validated once at startup.
 * A missing or malformed value fails loudly here rather than as a confusing
 * error deep inside a query.
 */
const serverEnvSchema = z.object({
  /** The running app's connection. In deployment this is a transaction-mode pooler. */
  DATABASE_URL: z.string().url(),

  /**
   * Migrations need a session-mode connection — a transaction pooler keeps no
   * session state between statements. Optional: locally there is no pooler, so
   * migrations fall back to DATABASE_URL.
   */
  MIGRATION_DATABASE_URL: z.string().url().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
})

const parsed = serverEnvSchema.safeParse(process.env)

if (!parsed.success) {
  const missing = Object.keys(z.flattenError(parsed.error).fieldErrors).join(", ")
  throw new Error(`Invalid environment variables: ${missing}. See .env.example.`)
}

export const env = parsed.data
