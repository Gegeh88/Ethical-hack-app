import { Redis } from 'ioredis';
import { config } from '../config.js';

/**
 * Creates a new Redis connection for BullMQ.
 * BullMQ manages its own connection lifecycle; each Worker/Queue needs its own.
 * maxRetriesPerRequest: null is required by BullMQ.
 *
 * Throws if REDIS_URL is not configured (BullMQ mode requires Redis).
 */
export function createRedisConnection(): Redis {
  if (!config.REDIS_URL) {
    throw new Error('REDIS_URL is required for BullMQ mode');
  }
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

/**
 * Lazy-initialized pub connection for emitting scan progress via Redis pub/sub.
 * Returns null when REDIS_URL is not configured (HTTP/serverless mode).
 */
let _redisPub: Redis | null = null;

export function getRedisPub(): Redis | null {
  if (!config.REDIS_URL) return null;
  if (!_redisPub) {
    _redisPub = new Redis(config.REDIS_URL);
  }
  return _redisPub;
}

/**
 * Backward-compatible export used by worker.ts (BullMQ entry point).
 * In HTTP mode this is null — callers must handle that.
 */
export const redisPub: Redis | null = config.REDIS_URL
  ? new Redis(config.REDIS_URL)
  : null;
