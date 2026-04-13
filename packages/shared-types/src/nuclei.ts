import { z } from 'zod';

// ============================================================
// Nuclei scanner constants (shared between worker + Cloud Run)
// ============================================================

export type NucleiSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_MAP: Record<string, NucleiSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
  unknown: 'info',
};

/**
 * Hardcoded allowlist of Nuclei template categories.
 * SECURITY: NEVER allow user-supplied templates.
 */
export const ALLOWED_CATEGORIES = new Set([
  'cves',
  'misconfiguration',
  'exposures',
  'takeovers',
  'technologies',
  'vulnerabilities',
]);

/**
 * Default template categories used for scanning.
 */
export const DEFAULT_SCAN_CATEGORIES = [
  'cves',
  'misconfiguration',
  'exposures',
  'vulnerabilities',
] as const;

export const SEVERITY_FILTER = ['info', 'low', 'medium', 'high', 'critical'] as const;

// ============================================================
// Host validation (shared between all layers)
// ============================================================

const HOST_REGEX = /^(?!-)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function isValidHost(host: string): boolean {
  return HOST_REGEX.test(host);
}

export function assertValidHost(host: string): string {
  if (!isValidHost(host)) {
    throw new Error(`Invalid hostname: ${host}`);
  }
  return host;
}

// ============================================================
// Finding normalization
// ============================================================

export interface NucleiFindingInput {
  source_agent: 'passive' | 'nuclei';
  template_id: string;
  title: string;
  description?: string | null;
  severity: NucleiSeverity;
  cvss_score?: number | null;
  cve?: string[];
  tags?: string[];
  matched_at?: string | null;
  evidence?: Record<string, unknown>;
}

/**
 * Map a single raw Nuclei JSON finding to the shared FindingInput format.
 * Truncates request/response evidence to 2000 chars to keep DB rows bounded.
 */
export function normalizeNucleiFinding(raw: Record<string, unknown>): NucleiFindingInput {
  const info = (raw.info ?? {}) as Record<string, unknown>;
  const classification = (info.classification ?? {}) as Record<string, unknown>;
  const rawSeverity = ((info.severity as string) ?? 'unknown').toLowerCase();

  return {
    source_agent: 'nuclei',
    template_id: (raw['template-id'] as string) ?? 'unknown',
    title: (info.name as string) ?? 'Unknown finding',
    description: (info.description as string) ?? null,
    severity: SEVERITY_MAP[rawSeverity] ?? 'info',
    cvss_score:
      typeof classification['cvss-score'] === 'number'
        ? (classification['cvss-score'] as number)
        : null,
    cve: Array.isArray(classification['cve-id'])
      ? (classification['cve-id'] as string[])
      : [],
    tags: Array.isArray(info.tags) ? (info.tags as string[]) : [],
    matched_at: (raw['matched-at'] as string) ?? null,
    evidence: {
      type: raw.type,
      host: raw.host,
      matcher_name: raw['matcher-name'],
      extracted_results: raw['extracted-results'],
      request:
        typeof raw.request === 'string' ? raw.request.slice(0, 2000) : undefined,
      response:
        typeof raw.response === 'string' ? raw.response.slice(0, 2000) : undefined,
    },
  };
}

// ============================================================
// Cloud Run scanner API schemas
// ============================================================

export const CloudRunScanRequest = z.object({
  scanJobId: z.string().uuid(),
  host: z.string(),
  isSharedHosting: z.boolean(),
  rateLimit: z.number().int().positive(),
  concurrency: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(),
  callbackUrl: z.string().url().optional(),
  callbackToken: z.string().optional(),
});
export type CloudRunScanRequest = z.infer<typeof CloudRunScanRequest>;

export const CloudRunScanResponseMeta = z.object({
  exitCode: z.number().nullable(),
  runId: z.string(),
  stderrTail: z.string(),
  durationMs: z.number(),
});

export const CloudRunScanResponse = z.object({
  findings: z.array(z.record(z.unknown())),
  metadata: CloudRunScanResponseMeta,
});
export type CloudRunScanResponse = z.infer<typeof CloudRunScanResponse>;

// ============================================================
// Internal progress callback schema
// ============================================================

export const ScanProgressCallback = z.object({
  scanJobId: z.string().uuid(),
  type: z.enum(['progress', 'state', 'done']),
  payload: z.record(z.unknown()),
});
export type ScanProgressCallback = z.infer<typeof ScanProgressCallback>;
