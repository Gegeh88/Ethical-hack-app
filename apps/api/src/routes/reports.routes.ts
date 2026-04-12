import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError } from '../lib/errors.js';
import { getReportByScanId } from '../services/report.service.js';

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export default async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // GET /scans/:id/report -- Get the report for a specific scan
  // -----------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/scans/:id/report',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
      if (!req.userOrgId) {
        throw new ForbiddenError('Szervezet szukseges');
      }

      const { id } = req.params;
      const report = await getReportByScanId(req.userOrgId, id);

      if (!report) {
        return { data: null, message: 'A riport meg nem kesz vagy nem erheto el' };
      }

      return {
        data: {
          id: report.id,
          scan_job_id: report.scan_job_id,
          domain_id: report.domain_id,
          summary_hu: report.summary_hu,
          pdf_url: report.pdf_url,
          finding_count: report.finding_count,
          severity_counts: report.severity_counts,
          generated_at: report.generated_at,
        },
      };
    },
  );
}
