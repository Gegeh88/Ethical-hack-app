import pino from 'pino';
import { config } from './config.js';

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
      redis: config.REDIS_URL,
      concurrency: config.BULL_CONCURRENCY,
    },
    'haxvibe-worker starting — Day 1 skeleton (no queues registered yet)',
  );

  // TODO(day2): Register BullMQ workers for scan, report, verification queues
  // TODO(day2): Initialize Redis pub/sub for scan progress emission
  // TODO(day3): Load scanner agents (DomainVerification, PassiveScanner, NucleiScanner)

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker');
    // TODO: await Promise.all([scanWorker.close(), reportWorker.close(), verificationWorker.close()])
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep process alive
  setInterval(() => {
    logger.debug('heartbeat');
  }, 30_000);
}

main().catch((err) => {
  logger.error({ err }, 'Worker bootstrap failed');
  process.exit(1);
});
