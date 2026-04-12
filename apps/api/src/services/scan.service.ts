import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { FastifyRequest } from 'fastify';
import type { ScanType as ScanTypeEnum, ScanStatus as ScanStatusEnum } from '@haxvibe/shared-types';
import { sql } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { ForbiddenError, ValidationError, NotFoundError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// BullMQ queue singleton
// ---------------------------------------------------------------------------

const redisConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const scanQueue = new Queue('scan', { connection: redisConnection });

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
  // 1. Verify domain belongs to org AND is verified (not expired)
  const [domain] = await sql`
    SELECT id, host, is_shared_hosting
    FROM domains
    WHERE id = ${domainId}
      AND organization_id = ${orgId}
      AND verified_at IS NOT NULL
      AND verification_expires_at > now()
  `;

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
  const [activeCount] = await sql`
    SELECT count(*)::int AS cnt
    FROM scan_jobs
    WHERE domain_id = ${domainId}
      AND status IN ('queued', 'running')
  `;

  if (activeCount && (activeCount.cnt as number) > 0) {
    throw new ValidationError('A scan is already running for this domain');
  }

  // 5. Create consent record
  const [consentRecord] = await sql`
    INSERT INTO consent_records (
      domain_id,
      user_id,
      tos_version,
      scan_scope,
      ip_address,
      user_agent,
      shared_hosting_acknowledged
    )
    VALUES (
      ${domainId},
      ${userId},
      ${consent.tosVersion},
      ${type},
      ${req.ip}::inet,
      ${req.headers['user-agent'] ?? null},
      ${consent.sharedHostingAck}
    )
    RETURNING id
  `;

  if (!consentRecord) {
    throw new Error('Failed to create consent record');
  }

  // 6. Create scan job
  const [scanJob] = await sql`
    INSERT INTO scan_jobs (
      organization_id,
      domain_id,
      requested_by,
      consent_record_id,
      type,
      status
    )
    VALUES (
      ${orgId},
      ${domainId},
      ${userId},
      ${consentRecord.id},
      ${type},
      'queued'
    )
    RETURNING id, organization_id, domain_id, requested_by, consent_record_id,
              type, status, progress, current_step, bull_job_id,
              queued_at, started_at, completed_at, error_message
  `;

  if (!scanJob) {
    throw new Error('Failed to create scan job');
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

  // 8. Enqueue BullMQ job
  const bullJob = await scanQueue.add('scan', {
    scanJobId: scanJob.id,
    domainId,
    host: domain.host,
    type,
    isSharedHosting: domain.is_shared_hosting,
  });

  // 9. Update scan_jobs with bull_job_id
  await sql`
    UPDATE scan_jobs
    SET bull_job_id = ${bullJob.id ?? null}
    WHERE id = ${scanJob.id}
  `;

  return {
    ...(scanJob as unknown as ScanJobRow),
    bull_job_id: bullJob.id ?? null,
  };
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

  // Build WHERE conditions dynamically
  const [countResult] = await sql`
    SELECT count(*)::int AS total
    FROM scan_jobs
    WHERE organization_id = ${orgId}
      ${domainId ? sql`AND domain_id = ${domainId}` : sql``}
      ${status ? sql`AND status = ${status}` : sql``}
  `;

  const rows = await sql`
    SELECT id, organization_id, domain_id, requested_by, consent_record_id,
           type, status, progress, current_step, bull_job_id,
           queued_at, started_at, completed_at, error_message
    FROM scan_jobs
    WHERE organization_id = ${orgId}
      ${domainId ? sql`AND domain_id = ${domainId}` : sql``}
      ${status ? sql`AND status = ${status}` : sql``}
    ORDER BY queued_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    data: rows as unknown as ScanJobRow[],
    total: (countResult?.total as number) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// getScanById
// ---------------------------------------------------------------------------

export async function getScanById(
  orgId: string,
  scanId: string,
): Promise<ScanDetailResult> {
  const [scan] = await sql`
    SELECT sj.id, sj.organization_id, sj.domain_id, sj.requested_by,
           sj.consent_record_id, sj.type, sj.status, sj.progress,
           sj.current_step, sj.bull_job_id, sj.queued_at, sj.started_at,
           sj.completed_at, sj.error_message,
           d.host
    FROM scan_jobs sj
    JOIN domains d ON d.id = sj.domain_id
    WHERE sj.id = ${scanId}
      AND sj.organization_id = ${orgId}
  `;

  if (!scan) {
    throw new NotFoundError('Scan not found');
  }

  // Fetch findings summary grouped by severity
  const severityCounts = await sql`
    SELECT severity::text, count(*)::int
    FROM vulnerabilities
    WHERE scan_job_id = ${scanId}
    GROUP BY severity
  `;

  return {
    ...(scan as unknown as ScanJobWithDomain),
    findings_summary: severityCounts as unknown as SeverityCount[],
  };
}

// ---------------------------------------------------------------------------
// Cleanup helper (called on server shutdown)
// ---------------------------------------------------------------------------

export async function closeScanQueue(): Promise<void> {
  await scanQueue.close();
  redisConnection.disconnect();
}
