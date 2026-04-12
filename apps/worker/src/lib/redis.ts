import { Redis } from 'ioredis';
import { config } from '../config.js';

/**
 * Creates a new Redis connection for BullMQ.
 * BullMQ manages its own connection lifecycle; each Worker/Queue needs its own.
 * maxRetriesPerRequest: null is required by BullMQ.
 */
export function createRedisConnection(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

/**
 * Dedicated pub connection for emitting scan progress via Redis pub/sub.
 * Shared across the worker process — NOT used by BullMQ.
 */
export const redisPub = new Redis(config.REDIS_URL);
