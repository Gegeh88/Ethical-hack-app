import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  GEMINI_API_KEY: z.string().min(20),
  GEMINI_MODEL_FAST: z.string().default('gemini-2.5-flash'),
  GEMINI_MODEL_SMART: z.string().default('gemini-2.5-pro'),

  BULL_CONCURRENCY: z.coerce.number().default(3),
  BULL_RATE_LIMIT_MAX: z.coerce.number().default(10),
  BULL_RATE_LIMIT_DURATION_MS: z.coerce.number().default(60_000),

  NUCLEI_MAX_DURATION_MS: z.coerce.number().default(600_000),
  NUCLEI_RATE_LIMIT: z.coerce.number().default(50),
  NUCLEI_CONCURRENCY: z.coerce.number().default(5),
  NUCLEI_IMAGE: z.string().default('projectdiscovery/nuclei:v3'),
  NUCLEI_NETWORK: z.string().default('nuclei-outbound'),
  NUCLEI_TEMPLATES_DIR: z.string().default('/opt/nuclei-templates'),
  SCANNER_TMP_DIR: z.string().default('/tmp/scanner'),
});

export type WorkerConfig = z.infer<typeof configSchema>;

function loadConfig(): WorkerConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[worker/config] Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
