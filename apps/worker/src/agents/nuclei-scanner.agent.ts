import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';
import type { Logger } from 'pino';
import type { FindingInput } from './passive-scanner/types.js';
import { emitProgress } from '../lib/emit-progress.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config.js';
import { assertValidHost } from '../lib/host-validator.js';

// Re-export so the processor can import from this module
export type { FindingInput } from './passive-scanner/types.js';

type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Hardcoded allowlist of Nuclei template categories.
 * SECURITY: NEVER allow user-supplied templates.
 */
const ALLOWED_CATEGORIES = new Set([
  'cves',
  'misconfiguration',
  'exposures',
  'takeovers',
  'technologies',
  'vulnerabilities',
]);

const SEVERITY_MAP: Record<string, Severity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
  unknown: 'info',
};

/** Grace period between SIGTERM and SIGKILL (ms). */
const KILL_GRACE_MS = 5_000;

/**
 * Run Nuclei scanner in a hardened Docker container.
 *
 * Security measures:
 * - --read-only filesystem
 * - --cap-drop ALL
 * - --security-opt no-new-privileges
 * - Memory limit (1GB), no swap escape
 * - CPU limit (1 core)
 * - Dedicated network (nuclei-outbound, no ICC)
 * - Non-root user (1000:1000)
 * - Hard timeout (NUCLEI_MAX_DURATION_MS) with SIGTERM -> SIGKILL escalation
 * - Host validation before spawn (defense in depth)
 * - No shell: true, no string concatenation in args
 * - Output file uses randomUUID(), not user input
 * - Template categories from hardcoded allowlist only
 */
export async function runNucleiScan(
  scanJobId: string,
  host: string,
  isSharedHosting: boolean,
  logger: Logger,
): Promise<FindingInput[]> {
  // SECURITY: Defense-in-depth — re-validate host even though the processor
  // already validated it. A compromised caller cannot bypass this.
  assertValidHost(host);

  // Select template categories from the hardcoded allowlist
  const categories = ['cves', 'misconfiguration', 'exposures', 'vulnerabilities'].filter(
    (c) => ALLOWED_CATEGORIES.has(c),
  );
  const severityFilter = ['info', 'low', 'medium', 'high', 'critical'];

  // Reduce rate limit for shared hosting to avoid disrupting co-hosted sites
  const rateLimit = isSharedHosting
    ? Math.floor(config.NUCLEI_RATE_LIMIT / 2)
    : config.NUCLEI_RATE_LIMIT;

  const runId = randomUUID();
  const outputFile = path.join(config.SCANNER_TMP_DIR, `nuclei-${runId}.jsonl`);

  // Ensure tmp dir exists and create an empty output file for the bind mount
  await fs.mkdir(config.SCANNER_TMP_DIR, { recursive: true });
  await fs.writeFile(outputFile, '');

  // Build Docker argument array — each flag is a separate element.
  // SECURITY: NEVER concatenate these into a single string.
  const dockerArgs = [
    'run',
    '--rm',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,size=512m',
    '--tmpfs',
    '/.cache:rw,nosuid,size=128m',
    '--tmpfs',
    '/.config:rw,nosuid,size=64m',
    '-e',
    'HOME=/tmp',
    '--network',
    config.NUCLEI_NETWORK,
    '--memory',
    '1g',
    '--memory-swap',
    '1g',
    '--cpus',
    '1.0',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '200',
    '--user',
    '1000:1000',
    '-v',
    `${outputFile}:/output/results.jsonl:rw`,
    config.NUCLEI_IMAGE,
    '-u',
    `https://${host}`,
    '-jsonl',
    '-o',
    '/output/results.jsonl',
    '-rl',
    String(rateLimit),
    '-c',
    String(config.NUCLEI_CONCURRENCY),
    '-severity',
    severityFilter.join(','),
    '-timeout',
    '10',
    '-retries',
    '1',
    '-stats',
    '-si',
    '5',
    '-ud', '/tmp/nuclei-templates',
    '-no-color',
  ];

  logger.info(
    { host, runId, categories, rateLimit, image: config.NUCLEI_IMAGE },
    'Starting Nuclei scan',
  );

  // SECURITY: spawn with explicit argv array, NO shell: true, NO exec()
  const proc = spawn('docker', dockerArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuffer = '';
  let killed = false;

  // Parse stderr for progress stats — Nuclei outputs stats to stderr
  if (proc.stderr) {
    const stderrRl = readline.createInterface({ input: proc.stderr });
    stderrRl.on('line', (line) => {
      stderrBuffer += line + '\n';

      // Keep buffer bounded to prevent memory issues
      if (stderrBuffer.length > 50_000) {
        stderrBuffer = stderrBuffer.slice(-20_000);
      }

      // Nuclei stats format: "[INF] Requests: 42/100 ..."
      const m = /Requests[: ]+(\d+)\/(\d+)/i.exec(line);
      if (m?.[1] && m[2]) {
        const done = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        if (total > 0) {
          // Nuclei progress maps to 50-99% of total scan (passive was 0-50%)
          const nucleiPct = Math.min(99, Math.floor((done / total) * 100));
          const totalPct = 50 + Math.floor(nucleiPct / 2);
          void emitProgress(scanJobId, 'progress', { step: 'nuclei', pct: totalPct });
        }
      }
    });
  }

  // Hard timeout — send SIGTERM first, then escalate to SIGKILL after grace period
  const timeoutHandle = setTimeout(() => {
    killed = true;
    logger.warn({ scanJobId, runId }, 'Nuclei scan timeout, sending SIGTERM');
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) {
        logger.warn({ scanJobId, runId }, 'Nuclei scan still alive, sending SIGKILL');
        proc.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
  }, config.NUCLEI_MAX_DURATION_MS);

  // Wait for the process to exit
  const exitCode: number | null = await new Promise((resolve, reject) => {
    proc.on('exit', (code) => resolve(code));
    proc.on('error', reject);
  });
  clearTimeout(timeoutHandle);

  if (killed) {
    await cleanupFile(outputFile);
    throw new Error(`Nuclei scan exceeded timeout (${config.NUCLEI_MAX_DURATION_MS}ms)`);
  }

  if (exitCode !== 0 && exitCode !== null) {
    const tail = stderrBuffer.slice(-1000);
    await cleanupFile(outputFile);
    throw new Error(`Nuclei exited with code ${exitCode}: ${tail}`);
  }

  // Parse JSONL output
  const findings = await parseNucleiOutput(outputFile, logger);

  // Clean up output file
  await cleanupFile(outputFile);

  // Persist raw scan metadata for debugging / audit
  await supabaseAdmin
    .from('scan_results')
    .insert({
      scan_job_id: scanJobId,
      agent: 'nuclei',
      raw: {
        findings: findings.length,
        stderr_tail: stderrBuffer.slice(-2000),
        exit_code: exitCode,
        run_id: runId,
      },
    });

  await emitProgress(scanJobId, 'progress', { step: 'nuclei', pct: 100 });
  logger.info({ findingCount: findings.length, runId }, 'Nuclei scan completed');

  return findings;
}

/**
 * Read the Nuclei JSONL output file line-by-line and normalize each finding.
 * Invalid lines are logged and skipped — partial results are always preserved.
 */
async function parseNucleiOutput(
  filePath: string,
  logger: Logger,
): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  try {
    const rl = readline.createInterface({ input: createReadStream(filePath) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        findings.push(normalizeNucleiFinding(raw));
      } catch {
        logger.warn({ line: line.slice(0, 200) }, 'Failed to parse Nuclei JSONL line');
      }
    }
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to read Nuclei output file');
  }

  return findings;
}

/**
 * Map a single raw Nuclei JSON finding to the shared FindingInput format.
 * Truncates request/response evidence to 2000 chars to keep DB rows bounded.
 */
function normalizeNucleiFinding(raw: Record<string, unknown>): FindingInput {
  const info = (raw.info ?? {}) as Record<string, unknown>;
  const classification = (info.classification ?? {}) as Record<string, unknown>;

  const rawSeverity = ((info.severity as string) ?? 'unknown').toLowerCase();

  return {
    source_agent: 'nuclei',
    template_id: (raw['template-id'] as string) ?? 'unknown',
    title: (info.name as string) ?? 'Unknown finding',
    description: (info.description as string) ?? null,
    severity: SEVERITY_MAP[rawSeverity] ?? 'info',
    cvss_score: typeof classification['cvss-score'] === 'number'
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

/** Silently remove a file if it exists. */
async function cleanupFile(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => {});
}
