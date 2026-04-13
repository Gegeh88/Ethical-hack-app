import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Worker execution mode: 'bullmq' (Redis polling) or 'http' (Cloud Run serverless)
  WORKER_MODE: z.enum(['bullmq', 'http']).default('bullmq'),
  WORKER_PORT: z.coerce.number().default(8080),

  // Auth token for HTTP mode (API -> worker calls)
  SCANNER_AUTH_TOKEN: z.string().min(20).optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),

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

  // Scanner execution mode: 'docker' (Docker-in-Docker) or 'cloudrun' (HTTP to Cloud Run)
  SCANNER_MODE: z.enum(['docker', 'cloudrun']).default('docker'),

  // Cloud Run settings (required when SCANNER_MODE=cloudrun)
  CLOUDRUN_SCANNER_URL: z.string().url().optional(),
  CLOUDRUN_SCANNER_AUTH_TOKEN: z.string().min(20).optional(),
  CLOUDRUN_SCANNER_TIMEOUT_MS: z.coerce.number().default(660_000), // slightly > NUCLEI_MAX_DURATION_MS

  // Callback URL for Cloud Run progress reports (API base URL)
  CLOUDRUN_CALLBACK_URL: z.string().url().optional(),
}).superRefine((data, ctx) => {
  // HTTP mode requires auth token
  if (data.WORKER_MODE === 'http') {
    if (!data.SCANNER_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SCANNER_AUTH_TOKEN'],
        message: 'Required when WORKER_MODE=http',
      });
    }
  }

  // BullMQ mode requires Redis
  if (data.WORKER_MODE === 'bullmq') {
    if (!data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'Required when WORKER_MODE=bullmq',
      });
    }
  }

  if (data.SCANNER_MODE === 'cloudrun') {
    if (!data.CLOUDRUN_SCANNER_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLOUDRUN_SCANNER_URL'],
        message: 'Required when SCANNER_MODE=cloudrun',
      });
    }
    if (!data.CLOUDRUN_SCANNER_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLOUDRUN_SCANNER_AUTH_TOKEN'],
        message: 'Required when SCANNER_MODE=cloudrun',
      });
    }
  }
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
