import { z } from "zod"

/**
 * Every environment variable the server needs, validated once at startup.
 * A missing or malformed value fails loudly here rather than as a confusing
 * error deep inside a query.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
})

const parsed = serverEnvSchema.safeParse(process.env)

if (!parsed.success) {
  const missing = Object.keys(z.flattenError(parsed.error).fieldErrors).join(", ")
  throw new Error(`Invalid environment variables: ${missing}. See .env.example.`)
}

export const env = parsed.data
