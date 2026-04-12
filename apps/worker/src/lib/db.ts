import postgres from 'postgres';
import { config } from '../config.js';

const dbUrl = (process.env.DATABASE_URL_POOLED ?? config.DATABASE_URL);

export const sql = postgres(dbUrl, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});
