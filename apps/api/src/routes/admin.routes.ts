import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PaginationQuery } from '@haxvibe/shared-types';
import { supabaseAdmin } from '../lib/supabase.js';
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

    // Count total scan jobs
    const { count: total, error: countError } = await supabaseAdmin
      .from('scan_jobs')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw new Error(`Failed to count scans: ${countError.message}`);
    }

    // Fetch scan jobs with domain host and org name
    // Supabase REST supports foreign key joins via the `table(columns)` syntax
    const { data: rows, error: rowsError } = await supabaseAdmin
      .from('scan_jobs')
      .select('*, domains!inner(host), organizations!inner(name)')
      .order('queued_at', { ascending: false })
      .range(offset, offset + query.limit - 1);

    if (rowsError) {
      throw new Error(`Failed to list admin scans: ${rowsError.message}`);
    }

    // Flatten the joined data to match the previous SQL response shape
    const flatRows = (rows ?? []).map((row) => {
      const { domains, organizations, ...scanFields } = row as Record<string, unknown>;
      return {
        ...scanFields,
        host: (domains as Record<string, unknown>)?.host ?? null,
        org_name: (organizations as Record<string, unknown>)?.name ?? null,
      };
    });

    await audit(req, {
      actor_id: req.userId,
      actor_type: 'admin',
      action: 'admin.scans.listed',
      metadata: { page: query.page, limit: query.limit },
    });

    return { data: flatRows, total: total ?? 0 };
  });

  // -----------------------------------------------------------------------
  // GET /audit-log -- View audit log entries
  // -----------------------------------------------------------------------
  fastify.get('/audit-log', async (req: FastifyRequest) => {
    const query = PaginationQuery.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    // Count total audit log entries
    const { count: total, error: countError } = await supabaseAdmin
      .from('audit_log')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw new Error(`Failed to count audit log entries: ${countError.message}`);
    }

    // Fetch audit log entries with actor name via foreign key join
    const { data: rows, error: rowsError } = await supabaseAdmin
      .from('audit_log')
      .select('*, app_users(display_name)')
      .order('created_at', { ascending: false })
      .range(offset, offset + query.limit - 1);

    if (rowsError) {
      throw new Error(`Failed to list audit log: ${rowsError.message}`);
    }

    // Flatten actor_name from the join
    const flatRows = (rows ?? []).map((row) => {
      const { app_users, ...logFields } = row as Record<string, unknown>;
      return {
        ...logFields,
        actor_name: (app_users as Record<string, unknown>)?.display_name ?? null,
      };
    });

    return { data: flatRows, total: total ?? 0 };
  });

  // -----------------------------------------------------------------------
  // GET /stats -- Dashboard summary statistics
  // -----------------------------------------------------------------------
  fastify.get('/stats', async () => {
    // Run all count queries in parallel
    const [orgResult, userResult, scanResult, domainResult, activeResult] = await Promise.all([
      supabaseAdmin.from('organizations').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('app_users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('scan_jobs').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('domains').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('scan_jobs')
        .select('*', { count: 'exact', head: true })
        .in('status', ['queued', 'running']),
    ]);

    return {
      data: {
        organizations: orgResult.count ?? 0,
        users: userResult.count ?? 0,
        scans: scanResult.count ?? 0,
        domains: domainResult.count ?? 0,
        activeScans: activeResult.count ?? 0,
      },
    };
  });
}
