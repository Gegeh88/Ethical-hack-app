import type { Logger } from 'pino';
import { assertValidHost, type NucleiFindingInput } from '@haxvibe/shared-types';
import { emitProgress } from '../lib/emit-progress.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config.js';

// Re-export for compatibility with existing imports
export type { NucleiFindingInput as FindingInput } from '@haxvibe/shared-types';

/**
 * Run Nuclei scan via Cloud Run HTTP service instead of Docker-in-Docker.
 *
 * The Cloud Run service runs Nuclei as a native binary, receives scan
 * parameters via HTTP POST, and returns findings as JSON.
 *
 * Progress is reported via HTTP callbacks to the API's internal endpoint,
 * which then publishes to Redis for SSE consumers.
 *
 * Security: Same defense-in-depth as Docker mode — host validation,
 * template allowlist, rate limiting, timeout. The Cloud Run service
 * re-validates everything server-side.
 */
export async function runNucleiScanCloudRun(
  scanJobId: string,
  host: string,
  isSharedHosting: boolean,
  logger: Logger,
): Promise<NucleiFindingInput[]> {
  // SECURITY: Defense-in-depth — re-validate host
  assertValidHost(host);

  const scannerUrl = config.CLOUDRUN_SCANNER_URL;
  const authToken = config.CLOUDRUN_SCANNER_AUTH_TOKEN;

  if (!scannerUrl || !authToken) {
    throw new Error('Cloud Run scanner not configured (CLOUDRUN_SCANNER_URL / CLOUDRUN_SCANNER_AUTH_TOKEN missing)');
  }

  const rateLimit = isSharedHosting
    ? Math.floor(config.NUCLEI_RATE_LIMIT / 2)
    : config.NUCLEI_RATE_LIMIT;

  const requestBody = {
    scanJobId,
    host,
    isSharedHosting,
    rateLimit,
    concurrency: config.NUCLEI_CONCURRENCY,
    maxDurationMs: config.NUCLEI_MAX_DURATION_MS,
    callbackUrl: config.CLOUDRUN_CALLBACK_URL
      ? `${config.CLOUDRUN_CALLBACK_URL}/internal/scan-progress`
      : undefined,
    callbackToken: authToken,
  };

  logger.info(
    { host, scanJobId, mode: 'cloudrun', scannerUrl, rateLimit },
    'Starting Nuclei scan via Cloud Run',
  );

  // HTTP call to Cloud Run with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.CLOUDRUN_SCANNER_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${scannerUrl}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`Cloud Run scanner returned ${response.status}: ${errorBody}`);
    }

    const result = await response.json() as {
      findings: NucleiFindingInput[];
      metadata: {
        exitCode: number | null;
        runId: string;
        stderrTail: string;
        durationMs: number;
      };
    };

    // Persist raw scan metadata for debugging / audit
    await supabaseAdmin
      .from('scan_results')
      .insert({
        scan_job_id: scanJobId,
        agent: 'nuclei',
        raw: {
          findings: result.findings.length,
          stderr_tail: result.metadata.stderrTail,
          exit_code: result.metadata.exitCode,
          run_id: result.metadata.runId,
          mode: 'cloudrun',
          duration_ms: result.metadata.durationMs,
        },
      });

    await emitProgress(scanJobId, 'progress', { step: 'nuclei', pct: 100 });
    logger.info(
      { findingCount: result.findings.length, runId: result.metadata.runId, durationMs: result.metadata.durationMs },
      'Nuclei Cloud Run scan completed',
    );

    return result.findings;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Cloud Run scanner timeout (${config.CLOUDRUN_SCANNER_TIMEOUT_MS}ms)`);
    }
    throw err;
  }
}
