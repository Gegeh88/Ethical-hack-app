import type { Job } from 'bullmq';
import pino from 'pino';
import { sql } from '../lib/db.js';
import { emitProgress } from '../lib/emit-progress.js';
import { assertValidHost } from '../lib/host-validator.js';
import { canScanDomain } from '../lib/can-scan-domain.js';
import { runPassiveScan } from '../agents/passive-scanner.agent.js';
import { runNucleiScan } from '../agents/nuclei-scanner.agent.js';
import type { FindingInput } from '../agents/passive-scanner.agent.js';

/**
 * Payload received from the BullMQ `scan` queue.
 * The API enqueues this when a user requests a scan.
 */
export interface ScanJobData {
  scanJobId: string;
  domainId: string;
  host: string;
  type: 'passive' | 'active' | 'full';
  isSharedHosting: boolean;
}

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Main scan job processor.
 *
 * Workflow:
 * 1. Defense-in-depth: re-verify domain authorization (canScanDomain)
 * 2. Validate host format (strict regex)
 * 3. Update status to running
 * 4. Run passive scan (always)
 * 5. Run Nuclei active scan if type is active/full
 * 6. Persist vulnerabilities
 * 7. Mark completed
 *
 * On failure: mark scan as failed, emit error, then re-throw
 * so BullMQ retries per defaultJobOptions.
 */
export async function processScanJob(job: Job<ScanJobData>): Promise<void> {
  const { scanJobId, domainId, host, type } = job.data;
  const jobLogger = logger.child({ scanJobId, host, type, agent: 'scan-processor' });

  try {
    // -------------------------------------------------------
    // SECURITY: Defense-in-depth authorization at worker level
    // -------------------------------------------------------
    jobLogger.info('Verifying domain authorization');

    // Look up the scan job to get the requester
    const [scanJob] = await sql`
      SELECT requested_by FROM scan_jobs WHERE id = ${scanJobId}
    `;
    if (!scanJob) {
      throw new Error(`Scan job ${scanJobId} not found`);
    }

    // Re-verify authorization (independent of API check)
    await canScanDomain(domainId, scanJob.requested_by as string);

    // Validate host format (prevents command injection in downstream processes)
    assertValidHost(host);

    // -------------------------------------------------------
    // 1. Update status to running
    // -------------------------------------------------------
    await sql`
      UPDATE scan_jobs SET status = 'running', started_at = now()
      WHERE id = ${scanJobId}
    `;
    await emitProgress(scanJobId, 'state', {
      status: 'running',
      progress: 0,
      step: 'passive',
    });

    // -------------------------------------------------------
    // 2. Run passive scan (always runs for every scan type)
    // -------------------------------------------------------
    jobLogger.info('Starting passive scan');
    const passiveFindings = await runPassiveScan(scanJobId, host, jobLogger);

    // -------------------------------------------------------
    // 3. Run Nuclei active scan if type is active or full
    // -------------------------------------------------------
    let nucleiFindings: FindingInput[] = [];
    if (type === 'active' || type === 'full') {
      jobLogger.info('Starting Nuclei active scan');
      await emitProgress(scanJobId, 'progress', { step: 'nuclei', pct: 50 });
      nucleiFindings = await runNucleiScan(scanJobId, host, job.data.isSharedHosting, jobLogger);
    }

    // -------------------------------------------------------
    // 4. Persist vulnerabilities to DB
    // -------------------------------------------------------
    const allFindings = [...passiveFindings, ...nucleiFindings];
    if (allFindings.length > 0) {
      await persistFindings(scanJobId, domainId, allFindings);
    }

    // -------------------------------------------------------
    // 5. Mark completed
    // -------------------------------------------------------
    await sql`
      UPDATE scan_jobs
      SET status = 'completed', progress = 100, current_step = 'done', completed_at = now()
      WHERE id = ${scanJobId}
    `;
    await emitProgress(scanJobId, 'done', { status: 'completed' });

    jobLogger.info(
      { findingCount: allFindings.length, passive: passiveFindings.length, nuclei: nucleiFindings.length },
      'Scan completed',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.slice(0, 4000) : undefined;
    jobLogger.error({ err }, 'Scan failed');

    await sql`
      UPDATE scan_jobs
      SET status = 'failed',
          error_message = ${message},
          error_stack = ${stack ?? null},
          completed_at = now()
      WHERE id = ${scanJobId}
    `.catch((dbErr) => {
      jobLogger.error({ dbErr }, 'Failed to mark scan as failed in DB');
    });

    await emitProgress(scanJobId, 'done', { status: 'failed', error: message }).catch((pubErr) => {
      jobLogger.warn({ pubErr }, 'Failed to emit failure progress');
    });

    throw err; // let BullMQ retry
  }
}

/**
 * Insert findings into the vulnerabilities table.
 * Uses individual INSERT statements with parameterized queries
 * (postgres tagged template protects against SQL injection).
 */
async function persistFindings(
  scanJobId: string,
  domainId: string,
  findings: FindingInput[],
): Promise<void> {
  for (const f of findings) {
    await sql`
      INSERT INTO vulnerabilities (
        scan_job_id, domain_id, source_agent, template_id,
        title, description, severity, cvss_score,
        cve, tags, matched_at, evidence
      )
      VALUES (
        ${scanJobId},
        ${domainId},
        ${f.source_agent},
        ${f.template_id},
        ${f.title},
        ${f.description ?? null},
        ${f.severity}::severity_level,
        ${f.cvss_score ?? null},
        ${f.cve ?? []},
        ${f.tags ?? []},
        ${f.matched_at ?? null},
        ${f.evidence ? JSON.stringify(f.evidence) : null}::jsonb
      )
    `;
  }
}
