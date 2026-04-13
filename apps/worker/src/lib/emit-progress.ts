import { getRedisPub } from './redis.js';
import { supabaseAdmin } from './supabase.js';

/**
 * Emits scan progress via Redis pub/sub (for SSE consumers) and persists
 * the progress percentage to the DB (for late subscribers / polling).
 *
 * When REDIS_URL is not configured (HTTP/serverless mode), Redis pub/sub
 * is skipped entirely — only the Supabase DB update runs.
 *
 * Channel format: `scan:{scanJobId}`
 * Message format: `{ type, payload }`
 */
export async function emitProgress(
  scanJobId: string,
  type: string,
  payload: unknown,
): Promise<void> {
  // Publish to Redis if available (BullMQ mode with SSE consumers)
  const pub = getRedisPub();
  if (pub) {
    await pub.publish(
      `scan:${scanJobId}`,
      JSON.stringify({ type, payload }),
    );
  }

  // Persist progress to DB so late subscribers can pick up current state
  if (type === 'progress' && typeof (payload as Record<string, unknown>)?.pct === 'number') {
    const p = payload as { pct: number; step?: string };
    await supabaseAdmin
      .from('scan_jobs')
      .update({ progress: p.pct, current_step: p.step ?? null })
      .eq('id', scanJobId);
  }
}
