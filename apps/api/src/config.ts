import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().default(4000),
  API_CORS_ORIGINS: z.string().default('http://localhost:3000'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_POOLED: z.string().url().optional(),

  CURRENT_TOS_VERSION: z.string().default('2026-04-01'),

  // URL of the Cloud Run scan-orchestrator service
  SCAN_ORCHESTRATOR_URL: z.string().url(),

  // Shared secret for authenticating with the scan-orchestrator
  SCANNER_AUTH_TOKEN: z.string().min(20),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[config] Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
