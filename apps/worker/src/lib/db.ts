// Legacy raw postgres connection — kept for potential future use.
// All worker code now uses Supabase REST (supabase.ts).
// Only instantiated if DATABASE_URL is set.
// Dynamic import to avoid crash when postgres package is not installed (Cloud Run).

import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

let sql: Sql | null = null;

const dbUrl = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;

if (dbUrl) {
  try {
    const { default: pg } = await import('postgres');
    sql = pg(dbUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  } catch {
    // postgres package not available (e.g. Cloud Run stripped build)
    sql = null;
  }
}

export { sql };
