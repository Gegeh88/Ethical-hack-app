import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';
import { ScanProgressCallback } from '@haxvibe/shared-types';
import { config } from '../config.js';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Internal routes — NOT for public consumption.
 * Called by the Cloud Run nuclei-runner service for progress callbacks.
 * Authenticated via SCANNER_AUTH_TOKEN (shared secret).
 */
export default async function internalRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /internal/scan-progress
   *
   * Receives progress updates from the Cloud Run scanner and:
   * 1. Publishes to Redis pub/sub (for SSE consumers)
   * 2. Persists progress to DB (for late subscribers / polling)
   */
  app.post('/scan-progress', async (req: FastifyRequest, reply: FastifyReply) => {
    // Verify scanner auth token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing authorization' });
    }

    const token = authHeader.slice(7);
    if (!config.SCANNER_AUTH_TOKEN || token !== config.SCANNER_AUTH_TOKEN) {
      return reply.code(403).send({ error: 'Invalid token' });
    }

    // Validate body
    const parsed = ScanProgressCallback.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { scanJobId, type, payload } = parsed.data;

    // Publish to Redis pub/sub (same channel format as worker's emitProgress)
    let redisPub: Redis | null = null;
    try {
      redisPub = new Redis(config.REDIS_URL);
      await redisPub.publish(
        `scan:${scanJobId}`,
        JSON.stringify({ type, payload }),
      );
    } catch (err) {
      req.log.warn({ err, scanJobId }, 'Failed to publish progress to Redis');
    } finally {
      if (redisPub) {
        await redisPub.quit().catch(() => {});
      }
    }

    // Persist progress to DB
    if (type === 'progress' && typeof (payload as Record<string, unknown>)?.pct === 'number') {
      const p = payload as { pct: number; step?: string };
      await supabaseAdmin
        .from('scan_jobs')
        .update({ progress: p.pct, current_step: p.step ?? null })
        .eq('id', scanJobId);
    }

    return reply.code(200).send({ ok: true });
  });
}
