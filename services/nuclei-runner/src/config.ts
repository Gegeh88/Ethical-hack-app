import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Shared secret for authenticating requests from the worker. */
  SCANNER_AUTH_TOKEN: z.string().min(20),

  /** Path to pre-downloaded Nuclei templates. */
  NUCLEI_TEMPLATES_DIR: z.string().default('/opt/nuclei-templates'),

  /** Absolute maximum scan duration (ms). Overrides per-request maxDurationMs if lower. */
  MAX_SCAN_DURATION_MS: z.coerce.number().default(600_000),

  /** Max rate limit allowed (prevents abuse via request body). */
  MAX_RATE_LIMIT: z.coerce.number().default(200),

  /** Max concurrency allowed. */
  MAX_CONCURRENCY: z.coerce.number().default(25),
});

export type RunnerConfig = z.infer<typeof configSchema>;

function loadConfig(): RunnerConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[nuclei-runner/config] Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
