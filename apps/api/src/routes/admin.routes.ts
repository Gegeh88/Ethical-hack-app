import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PaginationQuery } from '@haxvibe/shared-types';
import { sql } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { ForbiddenError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Route plugin — all routes prefixed with /api/v1/admin
// ---------------------------------------------------------------------------

export default async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // All admin routes require authentication + admin/owner role
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', async (req: FastifyRequest) => {
    if (req.userRole !== 'admin' && req.userRole !== 'owner') {
      throw new ForbiddenError('Admin hozzaferes szukseges');
    }
  });

  // -----------------------------------------------------------------------
  // GET /scans -- List all scans across all organizations
  // -----------------------------------------------------------------------
  fastify.get('/scans', async (req: FastifyRequest) => {
    const query = PaginationQuery.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const [countResult] = await sql`SELECT count(*)::int AS total FROM scan_jobs`;
    const rows = await sql`
      SELECT sj.*, d.host, o.name AS org_name
      FROM scan_jobs sj
      JOIN domains d ON d.id = sj.domain_id
      JOIN organizations o ON o.id = sj.organization_id
      ORDER BY sj.queued_at DESC
      LIMIT ${query.limit} OFFSET ${offset}
    `;

    await audit(req, {
      actor_id: req.userId,
      actor_type: 'admin',
      action: 'admin.scans.listed',
      metadata: { page: query.page, limit: query.limit },
    });

    return { data: rows, total: countResult?.total ?? 0 };
  });

  // -----------------------------------------------------------------------
  // GET /audit-log -- View audit log entries
  // -----------------------------------------------------------------------
  fastify.get('/audit-log', async (req: FastifyRequest) => {
    const query = PaginationQuery.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const [countResult] = await sql`SELECT count(*)::int AS total FROM audit_log`;
    const rows = await sql`
      SELECT al.*, au.display_name AS actor_name
      FROM audit_log al
      LEFT JOIN app_users au ON au.id = al.actor_id
      ORDER BY al.created_at DESC
      LIMIT ${query.limit} OFFSET ${offset}
    `;

    return { data: rows, total: countResult?.total ?? 0 };
  });

  // -----------------------------------------------------------------------
  // GET /stats -- Dashboard summary statistics
  // -----------------------------------------------------------------------
  fastify.get('/stats', async () => {
    const [orgCount] = await sql`SELECT count(*)::int AS total FROM organizations`;
    const [userCount] = await sql`SELECT count(*)::int AS total FROM app_users`;
    const [scanCount] = await sql`SELECT count(*)::int AS total FROM scan_jobs`;
    const [domainCount] = await sql`SELECT count(*)::int AS total FROM domains`;
    const [activeScans] = await sql`
      SELECT count(*)::int AS total
      FROM scan_jobs
      WHERE status IN ('queued', 'running')
    `;

    return {
      data: {
        organizations: orgCount?.total ?? 0,
        users: userCount?.total ?? 0,
        scans: scanCount?.total ?? 0,
        domains: domainCount?.total ?? 0,
        activeScans: activeScans?.total ?? 0,
      },
    };
  });
}
