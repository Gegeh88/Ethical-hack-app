import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PaginationQuery, Severity } from '@haxvibe/shared-types';
import { z } from 'zod';
import { ForbiddenError } from '../lib/errors.js';
import {
  listVulnerabilities,
  getVulnerabilityById,
} from '../services/vulnerability.service.js';

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

const ListVulnerabilitiesQuery = PaginationQuery.extend({
  severity: Severity.optional(),
  search: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export default async function vulnerabilitiesRoutes(fastify: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // GET /scans/:scanId/vulnerabilities — List vulnerabilities for a scan
  // -----------------------------------------------------------------------
  fastify.get<{ Params: { scanId: string } }>(
    '/scans/:scanId/vulnerabilities',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { scanId: string } }>, _reply: FastifyReply) => {
      if (!req.userOrgId) {
        throw new ForbiddenError('Organization required');
      }

      const { scanId } = req.params;
      const query = ListVulnerabilitiesQuery.parse(req.query);

      const result = await listVulnerabilities(
        req.userOrgId,
        scanId,
        query.page,
        query.limit,
        query.severity,
        query.search,
      );

      return { data: result.data, total: result.total };
    },
  );

  // -----------------------------------------------------------------------
  // GET /vulnerabilities/:id — Get single vulnerability detail
  // -----------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/vulnerabilities/:id',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
      if (!req.userOrgId) {
        throw new ForbiddenError('Organization required');
      }

      const { id } = req.params;
      const vulnerability = await getVulnerabilityById(req.userOrgId, id);

      return { data: vulnerability };
    },
  );
}
