import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { config } from './config.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import authPlugin from './middleware/auth.js';
import authRoutes from './routes/auth.routes.js';
import domainRoutes from './routes/domains.routes.js';
import verificationRoutes from './routes/verification.routes.js';
import { sql } from './lib/db.js';

async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
          : undefined,
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.API_CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(sensible);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(domainRoutes, { prefix: '/api/v1/domains' });
  await app.register(verificationRoutes, { prefix: '/api/v1/domains' });

  app.get('/api/v1/health', async () => {
    return {
      status: 'ok',
      service: 'haxvibe-api',
      version: '0.1.0',
      env: config.NODE_ENV,
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

async function main() {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down gracefully');
    await app.close();
    await sql.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
    app.log.info(`haxvibe-api listening on http://${config.API_HOST}:${config.API_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
