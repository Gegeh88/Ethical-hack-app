import type { Job } from 'bullmq';
import pino from 'pino';
import { supabaseAdmin } from '../lib/supabase.js';
import { emitProgress } from '../lib/emit-progress.js';
import { assertValidHost } from '../lib/host-validator.js';
import { canScanDomain } from '../lib/can-scan-domain.js';
import { runPassiveScan } from '../agents/passive-scanner.agent.js';
import { runNucleiScan } from '../agents/nuclei-scanner.agent.js';
import { generateReport } from '../agents/report-generator.agent.js';
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
    const { data: scanJob, error: scanJobError } = await supabaseAdmin
      .from('scan_jobs')
      .select('requested_by')
      .eq('id', scanJobId)
      .single();

    if (scanJobError || !scanJob) {
      throw new Error(`Scan job ${scanJobId} not found`);
    }

    // Re-verify authorization (independent of API check)
    await canScanDomain(domainId, scanJob.requested_by as string);

    // Validate host format (prevents command injection in downstream processes)
    assertValidHost(host);

    // -------------------------------------------------------
    // 1. Update status to running
    // -------------------------------------------------------
    await supabaseAdmin
      .from('scan_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', scanJobId);

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
    // 5. Generate report with AI enrichment (non-fatal)
    // -------------------------------------------------------
    jobLogger.info('Starting report generation');
    await emitProgress(scanJobId, 'progress', { step: 'report', pct: 80 });
    try {
      const { data: scanRow } = await supabaseAdmin
        .from('scan_jobs')
        .select('organization_id')
        .eq('id', scanJobId)
        .single();

      if (scanRow) {
        await generateReport(
          scanJobId,
          domainId,
          scanRow.organization_id as string,
          host,
          jobLogger,
        );
      } else {
        jobLogger.warn('Could not find scan job row for report generation');
      }
    } catch (err) {
      jobLogger.error({ err }, 'Report generation failed (non-fatal, scan still succeeds)');
    }

    // -------------------------------------------------------
    // 6. Mark completed
    // -------------------------------------------------------
    await supabaseAdmin
      .from('scan_jobs')
      .update({
        status: 'completed',
        progress: 100,
        current_step: 'done',
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanJobId);

    await emitProgress(scanJobId, 'done', { status: 'completed' });

    jobLogger.info(
      { findingCount: allFindings.length, passive: passiveFindings.length, nuclei: nucleiFindings.length },
      'Scan completed',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobLogger.error({ err }, 'Scan failed');

    try {
      await supabaseAdmin
        .from('scan_jobs')
        .update({
          status: 'failed',
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', scanJobId);
    } catch (dbErr) {
      jobLogger.error({ dbErr }, 'Failed to mark scan as failed in DB');
    }

    await emitProgress(scanJobId, 'done', { status: 'failed', error: message }).catch((pubErr) => {
      jobLogger.warn({ pubErr }, 'Failed to emit failure progress');
    });

    throw err; // let BullMQ retry
  }
}

/**
 * Insert findings into the vulnerabilities table.
 */
async function persistFindings(
  scanJobId: string,
  domainId: string,
  findings: FindingInput[],
): Promise<void> {
  for (const f of findings) {
    const { error } = await supabaseAdmin
      .from('vulnerabilities')
      .insert({
        scan_job_id: scanJobId,
        domain_id: domainId,
        source_agent: f.source_agent,
        template_id: f.template_id,
        title: f.title,
        description: f.description ?? null,
        severity: f.severity,
        cvss_score: f.cvss_score ?? null,
        cve: f.cve ?? [],
        tags: f.tags ?? [],
        matched_at: f.matched_at ?? null,
        evidence: f.evidence ? f.evidence : null,
      });

    if (error) {
      logger.warn({ error, finding: f.title }, 'Failed to persist finding');
    }
  }
}
