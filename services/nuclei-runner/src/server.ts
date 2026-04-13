import { createServer } from 'node:http';
import pino from 'pino';
import { CloudRunScanRequest } from '@haxvibe/shared-types';
import { config } from './config.js';
import { runScan } from './nuclei-runner.js';

const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

/**
 * Minimal HTTP server for Cloud Run.
 * Single endpoint: POST /scan
 */
const server = createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'nuclei-runner' }));
    return;
  }

  // Only accept POST /scan
  if (req.method !== 'POST' || req.url !== '/scan') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Verify auth token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing authorization' }));
    return;
  }

  const token = authHeader.slice(7);
  if (token !== config.SCANNER_AUTH_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }

  // Parse request body
  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk;
      // Limit body size to 1MB
      if (body.length > 1_048_576) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
    }
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to read request body' }));
    return;
  }

  // Validate request
  let parsed: ReturnType<typeof CloudRunScanRequest.safeParse>;
  try {
    parsed = CloudRunScanRequest.safeParse(JSON.parse(body));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Validation failed', details: parsed.error.flatten() }));
    return;
  }

  const scanRequest = parsed.data;
  logger.info({ scanJobId: scanRequest.scanJobId, host: scanRequest.host }, 'Scan request received');

  try {
    const result = await runScan(scanRequest);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      findings: result.findings,
      metadata: result.metadata,
    }));

    logger.info(
      { scanJobId: scanRequest.scanJobId, findings: result.findings.length, durationMs: result.metadata.durationMs },
      'Scan completed successfully',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, scanJobId: scanRequest.scanJobId }, 'Scan failed');

    const isTimeout = message.includes('timeout');
    res.writeHead(isTimeout ? 408 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(config.PORT, () => {
  logger.info(`nuclei-runner listening on port ${config.PORT}`);
});

// Graceful shutdown
const shutdown = () => {
  logger.info('Shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
