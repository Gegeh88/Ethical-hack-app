import { z } from 'zod';

// ============================================================
// Enums
// ============================================================
export const Severity = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof Severity>;

export const ScanType = z.enum(['passive', 'active', 'full']);
export type ScanType = z.infer<typeof ScanType>;

export const ScanStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const VerificationMethod = z.enum(['dns', 'meta', 'file']);
export type VerificationMethod = z.infer<typeof VerificationMethod>;

export const SubscriptionTier = z.enum(['free', 'pro', 'business']);
export type SubscriptionTier = z.infer<typeof SubscriptionTier>;

// ============================================================
// Core entities (placeholder — expanded Day 2+)
// ============================================================
export const Domain = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  host: z.string(),
  verified_at: z.string().datetime().nullable(),
  verification_method: VerificationMethod.nullable(),
  verification_expires_at: z.string().datetime().nullable(),
  is_shared_hosting: z.boolean(),
  created_at: z.string().datetime(),
});
export type Domain = z.infer<typeof Domain>;

export const ScanJob = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  domain_id: z.string().uuid(),
  requested_by: z.string().uuid(),
  type: ScanType,
  status: ScanStatus,
  progress: z.number().int().min(0).max(100),
  current_step: z.string().nullable(),
  queued_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  error_message: z.string().nullable(),
});
export type ScanJob = z.infer<typeof ScanJob>;

// ============================================================
// Finding schema (used by scanner agents and report generator)
// ============================================================
export const Finding = z.object({
  id: z.string().uuid().optional(),
  source_agent: z.enum(['passive', 'nuclei']),
  template_id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  severity: Severity,
  cvss_score: z.number().nullable().optional(),
  cve: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  matched_at: z.string().nullable().optional(),
  evidence: z.record(z.unknown()).optional(),
});
export type Finding = z.infer<typeof Finding>;

export const EnrichedFinding = Finding.extend({
  explanation: z.object({
    mi_ez: z.string(),
    miert_veszelyes: z.string(),
    javitas: z.array(z.string()),
  }),
});
export type EnrichedFinding = z.infer<typeof EnrichedFinding>;

// ============================================================
// Helpers
// ============================================================
export function severityRank(s: Severity): number {
  const rank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  return rank[s];
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export function countBySeverity(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
