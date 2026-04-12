import { supabaseAdmin } from '../lib/supabase.js';
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
  const { data: scan, error: scanError } = await supabaseAdmin
    .from('scan_jobs')
    .select('id')
    .eq('id', scanId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (scanError) {
    throw new Error(`Failed to verify scan ownership: ${scanError.message}`);
  }

  if (!scan) {
    throw new NotFoundError('Scan nem talalhato vagy nem tartozik a szervezethez');
  }

  // Fetch the report for this scan
  const { data: report, error: reportError } = await supabaseAdmin
    .from('reports')
    .select('id, scan_job_id, domain_id, summary_hu, pdf_url, finding_count, severity_counts, generated_at')
    .eq('scan_job_id', scanId)
    .maybeSingle();

  if (reportError) {
    throw new Error(`Failed to fetch report: ${reportError.message}`);
  }

  if (!report) {
    return null;
  }

  return report as unknown as ReportRow;
}
