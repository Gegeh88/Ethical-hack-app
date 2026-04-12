import { redisPub } from './redis.js';
import { supabaseAdmin } from './supabase.js';

/**
 * Emits scan progress via Redis pub/sub (for SSE consumers) and persists
 * the progress percentage to the DB (for late subscribers / polling).
 *
 * Channel format: `scan:{scanJobId}`
 * Message format: `{ type, payload }`
 */
export async function emitProgress(
  scanJobId: string,
  type: string,
  payload: unknown,
): Promise<void> {
  await redisPub.publish(
    `scan:${scanJobId}`,
    JSON.stringify({ type, payload }),
  );

  // Persist progress to DB so late subscribers can pick up current state
  if (type === 'progress' && typeof (payload as Record<string, unknown>)?.pct === 'number') {
    const p = payload as { pct: number; step?: string };
    await supabaseAdmin
      .from('scan_jobs')
      .update({ progress: p.pct, current_step: p.step ?? null })
      .eq('id', scanJobId);
  }
}
