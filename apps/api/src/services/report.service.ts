import { sql } from '../lib/db.js';
import { NotFoundError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportRow {
  id: string;
  scan_job_id: string;
  domain_id: string;
  summary_hu: string | null;
  pdf_url: string | null;
  finding_count: number;
  severity_counts: Record<string, number> | null;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// getReportByScanId
// ---------------------------------------------------------------------------

export async function getReportByScanId(
  orgId: string,
  scanId: string,
): Promise<ReportRow | null> {
  // Verify the scan belongs to the organization
  const [scan] = await sql`
    SELECT id FROM scan_jobs
    WHERE id = ${scanId}
      AND organization_id = ${orgId}
  `;

  if (!scan) {
    throw new NotFoundError('Scan nem talalhato vagy nem tartozik a szervezethez');
  }

  // Fetch the report for this scan
  const [report] = await sql`
    SELECT id, scan_job_id, domain_id, summary_hu, pdf_url,
           finding_count, severity_counts, generated_at
    FROM reports
    WHERE scan_job_id = ${scanId}
  `;

  if (!report) {
    return null;
  }

  return report as unknown as ReportRow;
}
