import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';
import { CreateScanRequest, PaginationQuery, ScanStatus } from '@haxvibe/shared-types';
import { z } from 'zod';
import { config } from '../config.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sql } from '../lib/db.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { createScan, listScans, getScanById } from '../services/scan.service.js';

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

const ListScansQuery = PaginationQuery.extend({
  domainId: z.string().uuid().optional(),
  status: ScanStatus.optional(),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export default async function scansRoutes(fastify: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // POST / — Create a new scan
  // -----------------------------------------------------------------------
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.userOrgId) {
        throw new ForbiddenError('You must create an organization before starting scans');
      }

      const body = CreateScanRequest.parse(req.body);

      const scanJob = await createScan(
        req.userOrgId,
        req.userId,
        body.domainId,
        body.type,
        body.consent,
        req,
      );

      return reply.status(201).send({ data: scanJob });
    },
  );

  // -----------------------------------------------------------------------
  // GET / — List scans for the user's organization
  // -----------------------------------------------------------------------
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, _reply: FastifyReply) => {
      if (!req.userOrgId) {
        throw new ForbiddenError('Organization required');
      }

      const query = ListScansQuery.parse(req.query);

      const result = await listScans(
        req.userOrgId,
        query.page,
        query.limit,
        query.domainId,
        query.status,
      );

      return { data: result.data, total: result.total };
    },
  );

  // -----------------------------------------------------------------------
  // GET /:id — Get scan detail with findings summary
  // -----------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (req, _reply: FastifyReply) => {
      if (!req.userOrgId) {
        throw new ForbiddenError('Organization required');
      }

      const { id } = req.params;
      const scan = await getScanById(req.userOrgId, id);
      return { data: scan };
    },
  );

  // -----------------------------------------------------------------------
  // GET /:id/stream — SSE progress stream
  // -----------------------------------------------------------------------
  fastify.get<{
    Params: { id: string };
    Querystring: { access_token?: string };
  }>(
    '/:id/stream',
    async (req, reply) => {
      // ------------------------------------------------------------------
      // Auth: support both Bearer header AND query param access_token
      // (EventSource API does not support custom headers)
      // ------------------------------------------------------------------
      const queryToken = req.query.access_token;
      const headerToken = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined;
      const token = headerToken ?? queryToken;

      if (!token) {
        return reply.unauthorized('Missing token');
      }

      const {
        data: { user: supabaseUser },
        error: authError,
      } = await supabaseAdmin.auth.getUser(token);

      if (authError || !supabaseUser) {
        req.log.warn({ error: authError?.message }, 'SSE auth failed');
        return reply.unauthorized('Invalid or expired token');
      }

      const [appUser] = await sql`
        SELECT id, organization_id FROM app_users WHERE id = ${supabaseUser.id}
      `;

      if (!appUser) {
        return reply.unauthorized('User not found');
      }

      const userOrgId = appUser.organization_id as string;
      const { id } = req.params;

      // ------------------------------------------------------------------
      // Verify ownership: scan must belong to the user's organization
      // ------------------------------------------------------------------
      const [scan] = await sql`
        SELECT id, status, progress, current_step
        FROM scan_jobs
        WHERE id = ${id} AND organization_id = ${userOrgId}
      `;

      if (!scan) {
        throw new NotFoundError('Scan not found');
      }

      // ------------------------------------------------------------------
      // Set SSE headers
      // ------------------------------------------------------------------
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (event: string, data: unknown): void => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Send current state immediately
      send('state', {
        status: scan.status,
        progress: scan.progress,
        step: scan.current_step,
      });

      // If already in a terminal state, close immediately
      if (['completed', 'failed', 'cancelled'].includes(scan.status as string)) {
        send('done', { status: scan.status });
        reply.raw.end();
        return;
      }

      // ------------------------------------------------------------------
      // Subscribe to Redis pub/sub for this exact scan channel
      // ------------------------------------------------------------------
      const sub = new Redis(config.REDIS_URL);
      await sub.subscribe(`scan:${id}`);

      sub.on('message', (_channel: string, message: string) => {
        try {
          const evt = JSON.parse(message) as { type: string; payload: unknown };
          send(evt.type, evt.payload);

          if (evt.type === 'done') {
            reply.raw.end();
            void sub.quit();
          }
        } catch (err) {
          req.log.warn({ err }, 'Invalid SSE message from Redis');
        }
      });

      // Heartbeat every 15 seconds to keep the connection alive
      const heartbeat = setInterval(() => {
        reply.raw.write(`: heartbeat\n\n`);
      }, 15_000);

      // Cleanup on client disconnect
      req.raw.on('close', () => {
        clearInterval(heartbeat);
        void sub.quit();
      });
    },
  );
}
