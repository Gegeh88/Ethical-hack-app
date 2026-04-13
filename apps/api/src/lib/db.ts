import postgres from 'postgres';
import { config } from '../config.js';

// DATABASE_URL is optional in Cloud Run mode (API uses Supabase REST).
// Only initialize the postgres client if DATABASE_URL is provided.
// Services that require raw SQL (e.g. org.service.ts) should check for sql
// being null before using it.

let sql: ReturnType<typeof postgres> | null = null;

if (config.DATABASE_URL) {
  const dbUrl = config.DATABASE_URL;
  const isPooled = dbUrl.includes('pooler.supabase.com');

  sql = postgres(dbUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: 'require',
    prepare: isPooled ? false : true,
  });
}

export { sql };
