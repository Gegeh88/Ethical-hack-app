import type { FindingInput } from './types.js';
import { assertPublicHost } from '../../lib/ssrf-guard.js';

/**
 * Robots.txt security check.
 *
 * Fetches the target's robots.txt and inspects it for:
 * - Sensitive paths disclosed in Disallow directives (low)
 * - Missing robots.txt (info)
 *
 * SSRF guard is applied before the fetch.
 */
export async function checkRobots(host: string): Promise<FindingInput[]> {
  await assertPublicHost(host);
  const findings: FindingInput[] = [];

  try {
    const resp = await fetch(`https://${host}/robots.txt`, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'HaxVibe-Scanner/1.0' },
    });

    if (resp.ok) {
      const text = await resp.text();

      // Check for sensitive paths in Disallow directives
      const sensitivePatterns = [
        '/admin',
        '/wp-admin',
        '/phpmyadmin',
        '/cpanel',
        '/backup',
        '/db',
        '/database',
        '/sql',
        '/config',
        '/.env',
        '/.git',
        '/api/internal',
        '/debug',
        '/test',
        '/staging',
      ];

      const disallowLines = text
        .split('\n')
        .filter((l) => l.trim().toLowerCase().startsWith('disallow:'))
        .map((l) => l.split(':').slice(1).join(':').trim().toLowerCase());

      const exposedPaths = disallowLines.filter((path) =>
        sensitivePatterns.some((pattern) => path.includes(pattern)),
      );

      if (exposedPaths.length > 0) {
        findings.push({
          source_agent: 'passive',
          template_id: 'robots.sensitive_paths_disclosed',
          title: 'Erzekeny utvonalak a robots.txt-ben',
          severity: 'low',
          description: `A robots.txt ${exposedPaths.length} erzekeny utvonalat fed fel, amelyek segithetik a tamadokat.`,
          evidence: { paths: exposedPaths },
          tags: ['robots', 'disclosure'],
        });
      }
    } else if (resp.status === 404) {
      findings.push({
        source_agent: 'passive',
        template_id: 'robots.missing',
        title: 'Hianyzo robots.txt',
        severity: 'info',
        description: 'A weboldal nem rendelkezik robots.txt fajllal.',
        evidence: { status: 404 },
        tags: ['robots'],
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    findings.push({
      source_agent: 'passive',
      template_id: 'robots.fetch_error',
      title: 'robots.txt lekeres sikertelen',
      severity: 'info',
      evidence: { error: message },
      tags: ['robots'],
    });
  }

  return findings;
}
