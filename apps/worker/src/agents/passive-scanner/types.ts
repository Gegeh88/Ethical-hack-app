/**
 * A single finding produced by a passive scanner check.
 * Maps directly to the `vulnerabilities` table columns.
 */
export interface FindingInput {
  source_agent: 'passive';
  template_id: string;
  title: string;
  description?: string | null;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  cvss_score?: number | null;
  cve?: string[];
  tags?: string[];
  matched_at?: string | null;
  evidence?: Record<string, unknown>;
}
