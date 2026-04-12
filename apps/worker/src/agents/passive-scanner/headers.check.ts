import { assertPublicHost } from '../../lib/ssrf-guard.js';
import type { FindingInput } from './types.js';

/**
 * Security headers configuration.
 * Maps header names to their template_id and severity when missing.
 */
const REQUIRED_HEADERS: ReadonlyArray<{
  header: string;
  templateId: string;
  severity: FindingInput['severity'];
  title: string;
  description: string;
}> = [
  {
    header: 'strict-transport-security',
    templateId: 'headers.missing_hsts',
    severity: 'high',
    title: 'Hianyzik a Strict-Transport-Security fejlec',
    description:
      'A HSTS fejlec nelkul a bongeszo nem kenyszeriti ki a HTTPS hasznalatat, igy lehetseges a man-in-the-middle tamadas.',
  },
  {
    header: 'content-security-policy',
    templateId: 'headers.missing_csp',
    severity: 'medium',
    title: 'Hianyzik a Content-Security-Policy fejlec',
    description:
      'CSP nelkul a weboldal sebezhetobb XSS (cross-site scripting) tamadasokkal szemben.',
  },
  {
    header: 'x-frame-options',
    templateId: 'headers.missing_xfo',
    severity: 'medium',
    title: 'Hianyzik az X-Frame-Options fejlec',
    description:
      'A fejlec nelkul a weboldal beagyazhato iframe-be, ami clickjacking tamadashoz vezethet.',
  },
  {
    header: 'x-content-type-options',
    templateId: 'headers.missing_xcto',
    severity: 'low',
    title: 'Hianyzik az X-Content-Type-Options fejlec',
    description:
      'A fejlec nelkul a bongeszo megprobalhatja kitalalni a tartalom tipusat (MIME sniffing), ami biztonsagi kockazatot jelent.',
  },
  {
    header: 'referrer-policy',
    templateId: 'headers.missing_referrer',
    severity: 'low',
    title: 'Hianyzik a Referrer-Policy fejlec',
    description:
      'A fejlec nelkul a bongeszo a teljes URL-t kuldheti referrer-kent mas oldalaknak, ami erzekeny informaciot szivarogtathat.',
  },
  {
    header: 'permissions-policy',
    templateId: 'headers.missing_permissions',
    severity: 'info',
    title: 'Hianyzik a Permissions-Policy fejlec',
    description:
      'A Permissions-Policy fejleccel korlatozhatok a bongeszo funkciok (kamera, mikrofon, geolokacio stb.).',
  },
];

/**
 * Headers that should NOT be present (information disclosure).
 */
const DISCLOSURE_HEADERS: ReadonlyArray<{
  header: string;
  templateId: string;
  title: string;
  description: string;
}> = [
  {
    header: 'x-powered-by',
    templateId: 'headers.powered_by_disclosure',
    title: 'X-Powered-By fejlec informaciot szivarogtat',
    description:
      'Az X-Powered-By fejlec elarulja a szerver technologiat, ami megkonnyiti a celzott tamadasokat.',
  },
];

/**
 * Security headers check.
 *
 * Fetches the target's root page over HTTPS and inspects response headers
 * for missing security headers and information disclosure.
 *
 * SSRF guard is applied before the fetch.
 */
export async function checkHeaders(host: string): Promise<FindingInput[]> {
  // SSRF guard: resolve hostname and verify it's not a private IP
  await assertPublicHost(host);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(`https://${host}/`, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'HaxVibe-Scanner/1.0 (security audit)',
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  const findings: FindingInput[] = [];
  const headers = response.headers;

  // Check for missing security headers
  for (const check of REQUIRED_HEADERS) {
    if (!headers.has(check.header)) {
      findings.push({
        source_agent: 'passive',
        template_id: check.templateId,
        severity: check.severity,
        title: check.title,
        description: check.description,
        matched_at: `https://${host}/`,
        tags: ['headers'],
      });
    }
  }

  // Check for disclosure headers
  for (const check of DISCLOSURE_HEADERS) {
    const value = headers.get(check.header);
    if (value) {
      findings.push({
        source_agent: 'passive',
        template_id: check.templateId,
        severity: 'low',
        title: check.title,
        description: check.description,
        matched_at: `https://${host}/`,
        evidence: { header: check.header, value },
        tags: ['headers', 'disclosure'],
      });
    }
  }

  // Server header with version number is a disclosure
  const server = headers.get('server');
  if (server && /\/[\d.]+/.test(server)) {
    findings.push({
      source_agent: 'passive',
      template_id: 'headers.server_disclosure',
      severity: 'low',
      title: 'Server fejlec verzioszamot tartalmaz',
      description: `A Server fejlec elarulja a szerver szoftver verziot (${server}), ami megkonnyiti a celzott tamadasokat.`,
      matched_at: `https://${host}/`,
      evidence: { header: 'server', value: server },
      tags: ['headers', 'disclosure'],
    });
  }

  return findings;
}
