import postgres from 'postgres';

// Legacy raw postgres connection — kept for potential future use.
// All worker code now uses Supabase REST (supabase.ts).
// Only instantiated if DATABASE_URL is set.

const dbUrl = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;

export const sql = dbUrl
  ? postgres(dbUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : (null as unknown as ReturnType<typeof postgres>);
