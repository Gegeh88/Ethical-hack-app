import pino from 'pino';
import { Worker } from 'bullmq';
import { config } from './config.js';
import { createRedisConnection, redisPub } from './lib/redis.js';
import { processScanJob } from './processors/scan.processor.js';

const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
});

async function main() {
  logger.info(
    {
      service: 'haxvibe-worker',
      version: '0.1.0',
      env: config.NODE_ENV,
      concurrency: config.BULL_CONCURRENCY,
    },
    'Starting worker',
  );

  // -------------------------------------------------------
  // Register BullMQ scan worker
  // -------------------------------------------------------
  const scanWorker = new Worker('scan', processScanJob, {
    connection: createRedisConnection(),
    concurrency: config.BULL_CONCURRENCY,
    limiter: {
      max: config.BULL_RATE_LIMIT_MAX,
      duration: config.BULL_RATE_LIMIT_DURATION_MS,
    },
  });

  scanWorker.on('completed', (job) => {
    logger.info(
      { jobId: job?.id, scanJobId: job?.data?.scanJobId },
      'Scan job completed',
    );
  });

  scanWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, scanJobId: job?.data?.scanJobId, err: err.message },
      'Scan job failed',
    );
  });

  scanWorker.on('error', (err) => {
    logger.error({ err }, 'Scan worker error');
  });

  logger.info(
    { concurrency: config.BULL_CONCURRENCY, rateLimit: config.BULL_RATE_LIMIT_MAX },
    'Scan worker registered',
  );

  // TODO(day6): Register report worker
  // TODO(day6): Register verification worker

  // -------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker');
    await scanWorker.close();
    if (redisPub) await redisPub.quit();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Worker bootstrap failed');
  process.exit(1);
});
