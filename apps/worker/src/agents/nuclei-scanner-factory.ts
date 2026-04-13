import type { Logger } from 'pino';
import type { FindingInput } from './passive-scanner/types.js';
import { config } from '../config.js';

/**
 * Factory that dispatches Nuclei scans to the correct backend
 * based on the SCANNER_MODE env var.
 *
 * - 'docker':   Docker-in-Docker (original, requires Docker socket)
 * - 'cloudrun': HTTP call to Cloud Run service (no Docker needed)
 */
export async function runNucleiScan(
  scanJobId: string,
  host: string,
  isSharedHosting: boolean,
  logger: Logger,
): Promise<FindingInput[]> {
  if (config.SCANNER_MODE === 'cloudrun') {
    const { runNucleiScanCloudRun } = await import('./nuclei-cloudrun.agent.js');
    return runNucleiScanCloudRun(scanJobId, host, isSharedHosting, logger);
  }

  const { runNucleiScan: runNucleiScanDocker } = await import('./nuclei-scanner.agent.js');
  return runNucleiScanDocker(scanJobId, host, isSharedHosting, logger);
}

// Re-export FindingInput so scan.processor.ts can import from here
export type { FindingInput } from './passive-scanner/types.js';
