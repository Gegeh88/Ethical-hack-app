import type { FindingInput } from './types.js';
import { assertPublicHost } from '../../lib/ssrf-guard.js';

interface CmsSignature {
  name: string;
  checks: Array<{
    type: 'header' | 'body';
    pattern: RegExp;
  }>;
}

/**
 * CMS fingerprint signatures.
 * Each CMS has one or more checks against response headers or body content.
 * Capture group 1 in the pattern (if present) is used as version string.
 */
const CMS_SIGNATURES: ReadonlyArray<CmsSignature> = [
  {
    name: 'WordPress',
    checks: [
      { type: 'body', pattern: /wp-content|wp-includes/i },
      {
        type: 'body',
        pattern: /<meta\s+name=["']generator["']\s+content=["']WordPress\s*([\d.]*)/i,
      },
      { type: 'header', pattern: /^Link:.*wp-json/mi },
    ],
  },
  {
    name: 'Joomla',
    checks: [
      { type: 'body', pattern: /\/media\/jui\/|\/components\/com_/i },
      { type: 'body', pattern: /<meta\s+name=["']generator["']\s+content=["']Joomla/i },
    ],
  },
  {
    name: 'Drupal',
    checks: [
      { type: 'body', pattern: /Drupal\.settings|drupal\.js/i },
      { type: 'header', pattern: /^X-Generator:\s*Drupal/mi },
      { type: 'body', pattern: /<meta\s+name=["']Generator["']\s+content=["']Drupal/i },
    ],
  },
  {
    name: 'Shopify',
    checks: [
      { type: 'body', pattern: /cdn\.shopify\.com/i },
      { type: 'header', pattern: /^X-ShopId:/mi },
    ],
  },
  {
    name: 'Wix',
    checks: [{ type: 'body', pattern: /static\.parastorage\.com|wix\.com/i }],
  },
];

/**
 * CMS detection via HTTP response fingerprinting.
 *
 * Fetches the target's root page over HTTPS and matches response headers
 * and body content against known CMS signatures.
 *
 * Reports:
 * - Detected CMS (info)
 * - WordPress-specific: exposed readme.html (low)
 *
 * SSRF guard is applied before any fetch.
 */
export async function detectCms(host: string): Promise<FindingInput[]> {
  await assertPublicHost(host);
  const findings: FindingInput[] = [];

  try {
    const resp = await fetch(`https://${host}/`, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'HaxVibe-Scanner/1.0' },
      redirect: 'follow',
    });

    if (!resp.ok) return findings;

    // Limit body read to 200KB to avoid memory issues on large pages
    const body = (await resp.text()).slice(0, 200_000);
    const headersRaw = Array.from(resp.headers.entries())
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    for (const cms of CMS_SIGNATURES) {
      let detected = false;
      let version: string | null = null;
      const matchedChecks: string[] = [];

      for (const check of cms.checks) {
        const text = check.type === 'header' ? headersRaw : body;
        const match = text.match(check.pattern);
        if (match) {
          detected = true;
          matchedChecks.push(check.type);
          // Extract version if captured
          if (match[1]) version = match[1];
        }
      }

      if (detected) {
        findings.push({
          source_agent: 'passive',
          template_id: `cms.detected_${cms.name.toLowerCase()}`,
          title: `${cms.name} CMS eszlelve${version ? ` (v${version})` : ''}`,
          severity: 'info',
          description: `A weboldal ${cms.name} tartalomkezelo rendszert hasznal.${version ? ` Verzio: ${version}.` : ''} Ellenorizze, hogy naprakesz-e.`,
          tags: ['cms', cms.name.toLowerCase()],
          evidence: { cms: cms.name, version, matched_via: matchedChecks },
        });

        // WordPress-specific: check for exposed readme.html
        if (cms.name === 'WordPress' && version) {
          try {
            const readmeResp = await fetch(`https://${host}/readme.html`, {
              signal: AbortSignal.timeout(10_000),
              headers: { 'User-Agent': 'HaxVibe-Scanner/1.0' },
            });
            if (readmeResp.ok) {
              findings.push({
                source_agent: 'passive',
                template_id: 'cms.wordpress_readme_exposed',
                title: 'WordPress readme.html elerheto',
                severity: 'low',
                description:
                  'A WordPress readme.html fajl publikusan elerheto, ami verzio informaciot szivarogtathat.',
                evidence: { url: `https://${host}/readme.html` },
                tags: ['cms', 'wordpress', 'disclosure'],
              });
            }
          } catch {
            // Ignore readme fetch errors — the main CMS finding is already recorded
          }
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    findings.push({
      source_agent: 'passive',
      template_id: 'cms.detection_failed',
      title: 'CMS felismeres sikertelen',
      severity: 'info',
      evidence: { error: message },
      tags: ['cms'],
    });
  }

  return findings;
}
