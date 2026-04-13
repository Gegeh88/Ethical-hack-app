import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';
import pino from 'pino';
import {
  assertValidHost,
  normalizeNucleiFinding,
  DEFAULT_SCAN_CATEGORIES,
  SEVERITY_FILTER,
  ALLOWED_CATEGORIES,
  type NucleiFindingInput,
} from '@haxvibe/shared-types';
import { config } from './config.js';
import { reportProgress } from './progress-reporter.js';

const logger = pino({ level: config.LOG_LEVEL });

/** Grace period between SIGTERM and SIGKILL (ms). */
const KILL_GRACE_MS = 5_000;
const TMP_DIR = '/tmp/scanner';

export interface ScanParams {
  scanJobId: string;
  host: string;
  isSharedHosting: boolean;
  rateLimit: number;
  concurrency: number;
  maxDurationMs: number;
  callbackUrl?: string;
  callbackToken?: string;
}

export interface ScanResult {
  findings: NucleiFindingInput[];
  metadata: {
    exitCode: number | null;
    runId: string;
    stderrTail: string;
    durationMs: number;
  };
}

/**
 * Execute a Nuclei scan as a native child process.
 *
 * Security:
 * - Host re-validated via assertValidHost (defense in depth)
 * - Template categories from hardcoded allowlist only
 * - Rate limit capped by server config
 * - Hard timeout with SIGTERM -> SIGKILL escalation
 * - No shell: true, no string concatenation in args
 */
export async function runScan(params: ScanParams): Promise<ScanResult> {
  const startTime = Date.now();
  const { scanJobId, host, isSharedHosting } = params;

  // SECURITY: Defense-in-depth — re-validate host
  assertValidHost(host);

  // Enforce server-side caps on rate limit and concurrency
  const rateLimit = Math.min(
    isSharedHosting ? Math.floor(params.rateLimit / 2) : params.rateLimit,
    config.MAX_RATE_LIMIT,
  );
  const concurrency = Math.min(params.concurrency, config.MAX_CONCURRENCY);
  const maxDuration = Math.min(params.maxDurationMs, config.MAX_SCAN_DURATION_MS);

  // Validate categories against allowlist
  const categories = DEFAULT_SCAN_CATEGORIES.filter((c) => ALLOWED_CATEGORIES.has(c));

  const runId = randomUUID();
  const outputFile = path.join(TMP_DIR, `nuclei-${runId}.jsonl`);

  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.writeFile(outputFile, '');

  // Build Nuclei CLI arguments — native binary, no Docker wrapping
  const nucleiArgs = [
    '-u', `https://${host}`,
    '-jsonl',
    '-o', outputFile,
    '-rl', String(rateLimit),
    '-c', String(concurrency),
    '-severity', SEVERITY_FILTER.join(','),
    '-t', config.NUCLEI_TEMPLATES_DIR + '/',
    '-timeout', '10',
    '-retries', '1',
    '-stats',
    '-si', '5',
    '-duc',
    '-no-color',
  ];

  logger.info(
    { host, runId, categories, rateLimit, concurrency, maxDuration, scanJobId },
    'Starting Nuclei scan',
  );

  // Emit initial progress
  if (params.callbackUrl && params.callbackToken) {
    await reportProgress(
      params.callbackUrl,
      params.callbackToken,
      scanJobId,
      'progress',
      { step: 'nuclei', pct: 50 },
    );
  }

  // Spawn Nuclei as native child process — NO shell, explicit argv
  const proc = spawn('nuclei', nucleiArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: '/home/scanner',
    },
  });

  let stderrBuffer = '';
  let killed = false;

  // Parse stderr for progress
  if (proc.stderr) {
    const stderrRl = readline.createInterface({ input: proc.stderr });
    stderrRl.on('line', (line) => {
      stderrBuffer += line + '\n';
      if (stderrBuffer.length > 50_000) {
        stderrBuffer = stderrBuffer.slice(-20_000);
      }

      // Parse Nuclei stats: "[INF] Requests: 42/100 ..."
      const m = /Requests[: ]+(\d+)\/(\d+)/i.exec(line);
      if (m?.[1] && m[2]) {
        const done = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        if (total > 0 && params.callbackUrl && params.callbackToken) {
          const nucleiPct = Math.min(99, Math.floor((done / total) * 100));
          const totalPct = 50 + Math.floor(nucleiPct / 2);
          void reportProgress(
            params.callbackUrl,
            params.callbackToken,
            scanJobId,
            'progress',
            { step: 'nuclei', pct: totalPct },
          );
        }
      }
    });
  }

  // Hard timeout with SIGTERM -> SIGKILL escalation
  const timeoutHandle = setTimeout(() => {
    killed = true;
    logger.warn({ scanJobId, runId }, 'Nuclei scan timeout, sending SIGTERM');
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) {
        logger.warn({ scanJobId, runId }, 'Nuclei still alive, sending SIGKILL');
        proc.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
  }, maxDuration);

  // Wait for exit
  const exitCode: number | null = await new Promise((resolve, reject) => {
    proc.on('exit', (code) => resolve(code));
    proc.on('error', reject);
  });
  clearTimeout(timeoutHandle);

  const durationMs = Date.now() - startTime;

  if (killed) {
    await cleanupFile(outputFile);
    throw new Error(`Nuclei scan exceeded timeout (${maxDuration}ms)`);
  }

  if (exitCode !== 0 && exitCode !== null) {
    const tail = stderrBuffer.slice(-1000);
    await cleanupFile(outputFile);
    throw new Error(`Nuclei exited with code ${exitCode}: ${tail}`);
  }

  // Parse JSONL output
  const findings = await parseNucleiOutput(outputFile);
  await cleanupFile(outputFile);

  // Emit completion progress
  if (params.callbackUrl && params.callbackToken) {
    await reportProgress(
      params.callbackUrl,
      params.callbackToken,
      scanJobId,
      'progress',
      { step: 'nuclei', pct: 100 },
    );
  }

  logger.info({ findingCount: findings.length, runId, durationMs }, 'Nuclei scan completed');

  return {
    findings,
    metadata: {
      exitCode,
      runId,
      stderrTail: stderrBuffer.slice(-2000),
      durationMs,
    },
  };
}

/**
 * Parse JSONL output line-by-line. Invalid lines are skipped.
 */
async function parseNucleiOutput(filePath: string): Promise<NucleiFindingInput[]> {
  const findings: NucleiFindingInput[] = [];

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

async function cleanupFile(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => {});
}
