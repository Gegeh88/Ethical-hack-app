import type { Logger } from 'pino';
import { checkSsl } from './passive-scanner/ssl.check.js';
import { checkHeaders } from './passive-scanner/headers.check.js';
import { checkDns } from './passive-scanner/dns.check.js';
import { checkRobots } from './passive-scanner/robots.check.js';
import { checkPorts } from './passive-scanner/ports.check.js';
import { detectCms } from './passive-scanner/cms-detect.check.js';
import { emitProgress } from '../lib/emit-progress.js';
import { sql } from '../lib/db.js';
import type { FindingInput } from './passive-scanner/types.js';

// Re-export FindingInput so the processor can use it
export type { FindingInput } from './passive-scanner/types.js';

/**
 * Orchestrates all passive scanner checks in parallel.
 *
 * Each check runs independently with its own 30-second timeout.
 * If a check fails, it produces an info-level finding instead of crashing
 * the entire scan. Progress is emitted after each check completes.
 *
 * The passive scan occupies 0-50% of total scan progress
 * (the remaining 50% is reserved for active/nuclei scan).
 */
export async function runPassiveScan(
  scanJobId: string,
  host: string,
  logger: Logger,
): Promise<FindingInput[]> {
  const checks = [
    { name: 'ssl', fn: () => checkSsl(host) },
    { name: 'headers', fn: () => checkHeaders(host) },
    { name: 'dns', fn: () => checkDns(host) },
    { name: 'robots', fn: () => checkRobots(host) },
    { name: 'ports', fn: () => checkPorts(host) },
    { name: 'cms', fn: () => detectCms(host) },
  ];

  const total = checks.length;
  const findings: FindingInput[] = [];
  let completed = 0;

  await Promise.all(
    checks.map(async (check) => {
      try {
        // Race the check against a 30-second timeout
        const result = await Promise.race([
          check.fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Check timeout (30s)')), 30_000),
          ),
        ]);
        findings.push(...result);
        logger.info({ check: check.name, findingCount: result.length }, 'Passive check completed');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ check: check.name, err: message }, 'Passive check failed');
        findings.push({
          source_agent: 'passive',
          template_id: `internal.${check.name}_failed`,
          title: `${check.name} ellenorzes nem futott le`,
          severity: 'info',
          description: `A(z) ${check.name} ellenorzes technikai okbol nem fejezodott be: ${message}`,
          evidence: { error: message },
        });
      } finally {
        completed++;
        await emitProgress(scanJobId, 'progress', {
          step: 'passive',
          pct: Math.floor((completed / total) * 50), // passive scan is 0-50% of total
        }).catch((pubErr) => {
          logger.warn({ err: pubErr }, 'Failed to emit progress');
        });
      }
    }),
  );

  // Store raw results for debugging / audit
  await sql`
    INSERT INTO scan_results (scan_job_id, agent, raw)
    VALUES (${scanJobId}, 'passive', ${JSON.stringify({ findings, host, checks: checks.map((c) => c.name) })}::jsonb)
  `;

  logger.info({ totalFindings: findings.length }, 'Passive scan completed');
  return findings;
}
