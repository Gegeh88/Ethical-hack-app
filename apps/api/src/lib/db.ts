import postgres from 'postgres';
import { config } from '../config.js';

// Use pooled connection if available (port 6543, firewall-friendly),
// fall back to direct connection (port 5432).
// Pooler (pgbouncer transaction mode) requires prepare: false.
const dbUrl = config.DATABASE_URL;
const isPooled = dbUrl.includes('pooler.supabase.com');

export const sql = postgres(dbUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 15,
  ssl: 'require',
  prepare: isPooled ? false : true,
});
