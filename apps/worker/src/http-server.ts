/**
 * HTTP server entry point for Cloud Run (no BullMQ/Redis).
 *
 * Alternative to worker.ts — receives scan jobs via HTTP POST /execute
 * instead of polling a BullMQ queue. This lets the worker run as a
 * stateless Cloud Run service with zero Redis dependency.
 *
 * Auth: Bearer token (SCANNER_AUTH_TOKEN) on every request.
 * Body: { scanJobId, domainId, host, type, isSharedHosting }
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import pino from 'pino';
import { z } from 'zod';
import { config } from './config.js';
import { executeScan, type ScanJobData } from './processors/scan.processor.js';

const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
});

// -------------------------------------------------------------------
// Request body schema — strict validation before executing anything
// -------------------------------------------------------------------
const executeBodySchema = z.object({
  scanJobId: z.string().uuid(),
  domainId: z.string().uuid(),
  host: z.string().min(1).max(253),
  type: z.enum(['passive', 'active', 'full']),
  isSharedHosting: z.boolean(),
});

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 64 * 1024; // 64 KB — scan payloads are tiny

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function validateAuth(req: IncomingMessage): boolean {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return false;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;

  // Constant-time comparison to prevent timing attacks
  const token = parts[1]!;
  const expected = config.SCANNER_AUTH_TOKEN!;
  if (token.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// -------------------------------------------------------------------
// Route handler
// -------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // Health check — no auth required (Cloud Run uses this)
  if (url === '/health' && method === 'GET') {
    json(res, 200, { status: 'ok', mode: 'http', timestamp: new Date().toISOString() });
    return;
  }

  // Execute scan
  if (url === '/execute' && method === 'POST') {
    // Auth check
    if (!validateAuth(req)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch {
      json(res, 413, { error: 'Request body too large' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const result = executeBodySchema.safeParse(parsed);
    if (!result.success) {
      json(res, 400, { error: 'Validation failed', details: result.error.flatten().fieldErrors });
      return;
    }

    const data: ScanJobData = result.data;
    logger.info({ scanJobId: data.scanJobId, host: data.host, type: data.type }, 'Received scan request');

    // Respond immediately with 202 Accepted — scan runs in background.
    // Cloud Run will keep the instance alive until the process finishes
    // (request timeout up to 60min).
    // We do NOT run in background — Cloud Run counts request duration,
    // and we need the process to stay alive for the full scan.
    try {
      await executeScan(data);
      json(res, 200, { status: 'completed', scanJobId: data.scanJobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, scanJobId: data.scanJobId }, 'Scan execution failed');
      // The scan is already marked as failed in DB by executeScan's catch block.
      // Return 200 (not 500) so Cloud Run doesn't retry — the failure is recorded.
      json(res, 200, { status: 'failed', scanJobId: data.scanJobId, error: message });
    }
    return;
  }

  // 404 for everything else
  json(res, 404, { error: 'Not found' });
}

// -------------------------------------------------------------------
// Server bootstrap
// -------------------------------------------------------------------

const port = config.WORKER_PORT;

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    logger.error({ err }, 'Unhandled request error');
    if (!res.headersSent) {
      json(res, 500, { error: 'Internal server error' });
    }
  });
});

server.listen(port, () => {
  logger.info(
    {
      service: 'haxvibe-scan-orchestrator',
      version: '0.1.0',
      mode: 'http',
      port,
      env: config.NODE_ENV,
    },
    'HTTP server started',
  );
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down HTTP server');
  server.close(() => {
    process.exit(0);
  });
  // Force exit after 30s if connections hang
  setTimeout(() => process.exit(1), 30_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
