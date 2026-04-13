import type { FastifyRequest } from 'fastify';
import type { ScanType as ScanTypeEnum, ScanStatus as ScanStatusEnum } from '@haxvibe/shared-types';
import { supabaseAdmin } from '../lib/supabase.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { ForbiddenError, ValidationError, NotFoundError, RateLimitError } from '../lib/errors.js';
import { checkScanQuota, checkScanTypeAllowed } from './quota.service.js';

// Map ScanType enum to DB consent_records.scan_scope check constraint values
const SCAN_SCOPE_MAP: Record<string, string> = {
  passive: 'passive_only',
  active: 'active_scan',
  full: 'full',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanJobRow {
  id: string;
  organization_id: string;
  domain_id: string;
  requested_by: string;
  consent_record_id: string | null;
  type: ScanTypeEnum;
  status: ScanStatusEnum;
  progress: number;
  current_step: string | null;
  bull_job_id: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface ScanJobWithDomain extends ScanJobRow {
  host: string;
}

interface SeverityCount {
  severity: string;
  count: number;
}

interface ScanDetailResult extends ScanJobWithDomain {
  findings_summary: SeverityCount[];
}

interface ListScansResult {
  data: ScanJobRow[];
  total: number;
}

interface ConsentInput {
  tosVersion: string;
  sharedHostingAck: boolean;
}

// ---------------------------------------------------------------------------
// createScan
// ---------------------------------------------------------------------------

export async function createScan(
  orgId: string,
  userId: string,
  domainId: string,
  type: ScanTypeEnum,
  consent: ConsentInput,
  req: FastifyRequest,
): Promise<ScanJobRow> {
  // 0a. Quota check — enforce monthly scan limit
  const quota = await checkScanQuota(orgId);
  if (!quota.allowed) {
    throw new RateLimitError(quota.reason!);
  }

  // 0b. Scan type check — free tier: passive only
  const typeAllowed = await checkScanTypeAllowed(orgId, type);
  if (!typeAllowed) {
    throw new ForbiddenError('Aktiv vizsgalathoz Pro vagy Business csomag szukseges');
  }

  // 1. Verify domain belongs to org AND is verified (not expired)
  const { data: domain, error: domainError } = await supabaseAdmin
    .from('domains')
    .select('id, host, is_shared_hosting')
    .eq('id', domainId)
    .eq('organization_id', orgId)
    .not('verified_at', 'is', null)
    .gt('verification_expires_at', new Date().toISOString())
    .maybeSingle();

  if (domainError) {
    throw new Error(`Failed to verify domain: ${domainError.message}`);
  }

  if (!domain) {
    throw new ForbiddenError(
      'Domain not found, does not belong to your organization, or is not verified',
    );
  }

  // 2. Validate consent — TOS version must match current
  if (consent.tosVersion !== config.CURRENT_TOS_VERSION) {
    throw new ValidationError(
      `Consent must reference the current Terms of Service version (${config.CURRENT_TOS_VERSION})`,
    );
  }

  // 3. Shared hosting acknowledgement
  if (domain.is_shared_hosting && !consent.sharedHostingAck) {
    throw new ValidationError(
      'Shared hosting domain requires explicit acknowledgement (sharedHostingAck must be true)',
    );
  }

  // 4. No active scan already running for this domain
  const { count: activeCount, error: activeError } = await supabaseAdmin
    .from('scan_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('domain_id', domainId)
    .in('status', ['queued', 'running']);

  if (activeError) {
    throw new Error(`Failed to check active scans: ${activeError.message}`);
  }

  if (activeCount && activeCount > 0) {
    throw new ValidationError('A scan is already running for this domain');
  }

  // 5. Create consent record
  const { data: consentRecord, error: consentError } = await supabaseAdmin
    .from('consent_records')
    .insert({
      domain_id: domainId,
      user_id: userId,
      tos_version: consent.tosVersion,
      scan_scope: SCAN_SCOPE_MAP[type] ?? type,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'] ?? null,
      shared_hosting_acknowledged: consent.sharedHostingAck,
    })
    .select('id')
    .single();

  if (consentError || !consentRecord) {
    throw new Error(`Failed to create consent record: ${consentError?.message ?? 'no data returned'}`);
  }

  // 6. Create scan job
  const { data: scanJob, error: scanJobError } = await supabaseAdmin
    .from('scan_jobs')
    .insert({
      organization_id: orgId,
      domain_id: domainId,
      requested_by: userId,
      consent_record_id: consentRecord.id,
      type,
      status: 'queued',
    })
    .select('id, organization_id, domain_id, requested_by, consent_record_id, type, status, progress, current_step, bull_job_id, queued_at, started_at, completed_at, error_message')
    .single();

  if (scanJobError || !scanJob) {
    throw new Error(`Failed to create scan job: ${scanJobError?.message ?? 'no data returned'}`);
  }

  // 7. Audit log
  await audit(req, {
    actor_id: userId,
    action: 'scan.requested',
    resource_type: 'scan_job',
    resource_id: scanJob.id as string,
    metadata: {
      domain_id: domainId,
      host: domain.host,
      type,
      consent_record_id: consentRecord.id,
    },
  });

  // 8. Trigger scan orchestrator (fire-and-forget)
  const orchestratorUrl = config.SCAN_ORCHESTRATOR_URL;
  const authToken = config.SCANNER_AUTH_TOKEN;

  fetch(`${orchestratorUrl}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      scanJobId: scanJob.id,
      domainId,
      host: domain.host,
      type,
      isSharedHosting: domain.is_shared_hosting,
    }),
  }).catch((err) => {
    // Log but don't fail the API response — the scan job is already in DB
    req.log.error({ err, scanJobId: scanJob.id }, 'Failed to trigger scan orchestrator');
  });

  return scanJob as unknown as ScanJobRow;
}

// ---------------------------------------------------------------------------
// listScans
// ---------------------------------------------------------------------------

export async function listScans(
  orgId: string,
  page: number,
  limit: number,
  domainId?: string,
  status?: ScanStatusEnum,
): Promise<ListScansResult> {
  const offset = (page - 1) * limit;

  // Build count query with optional filters
  let countQuery = supabaseAdmin
    .from('scan_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  if (domainId) {
    countQuery = countQuery.eq('domain_id', domainId);
  }
  if (status) {
    countQuery = countQuery.eq('status', status);
  }

  const { count, error: countError } = await countQuery;

  if (countError) {
    throw new Error(`Failed to count scans: ${countError.message}`);
  }

  // Build data query with optional filters
  let dataQuery = supabaseAdmin
    .from('scan_jobs')
    .select('id, organization_id, domain_id, requested_by, consent_record_id, type, status, progress, current_step, bull_job_id, queued_at, started_at, completed_at, error_message')
    .eq('organization_id', orgId)
    .order('queued_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (domainId) {
    dataQuery = dataQuery.eq('domain_id', domainId);
  }
  if (status) {
    dataQuery = dataQuery.eq('status', status);
  }

  const { data: rows, error: rowsError } = await dataQuery;

  if (rowsError) {
    throw new Error(`Failed to list scans: ${rowsError.message}`);
  }

  return {
    data: (rows ?? []) as unknown as ScanJobRow[],
    total: count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// getScanById
// ---------------------------------------------------------------------------

export async function getScanById(
  orgId: string,
  scanId: string,
): Promise<ScanDetailResult> {
  // Fetch scan job
  const { data: scanJob, error: scanError } = await supabaseAdmin
    .from('scan_jobs')
    .select('id, organization_id, domain_id, requested_by, consent_record_id, type, status, progress, current_step, bull_job_id, queued_at, started_at, completed_at, error_message')
    .eq('id', scanId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (scanError) {
    throw new Error(`Failed to fetch scan: ${scanError.message}`);
  }

  if (!scanJob) {
    throw new NotFoundError('Scan not found');
  }

  // Fetch domain host separately (replaces the SQL JOIN)
  const { data: domain, error: domainError } = await supabaseAdmin
    .from('domains')
    .select('host')
    .eq('id', scanJob.domain_id)
    .single();

  if (domainError || !domain) {
    throw new Error(`Failed to fetch domain for scan: ${domainError?.message ?? 'domain not found'}`);
  }

  // Fetch findings summary grouped by severity
  // Supabase REST does not support GROUP BY + count, so we fetch all severity
  // values and aggregate in JS.
  const { data: vulns, error: vulnError } = await supabaseAdmin
    .from('vulnerabilities')
    .select('severity')
    .eq('scan_job_id', scanId);

  if (vulnError) {
    throw new Error(`Failed to fetch findings summary: ${vulnError.message}`);
  }

  const severityMap = new Map<string, number>();
  for (const v of vulns ?? []) {
    const sev = v.severity as string;
    severityMap.set(sev, (severityMap.get(sev) ?? 0) + 1);
  }

  const findings_summary: SeverityCount[] = Array.from(severityMap.entries()).map(
    ([severity, count]) => ({ severity, count }),
  );

  return {
    ...(scanJob as unknown as ScanJobWithDomain),
    host: domain.host as string,
    findings_summary,
  };
}
