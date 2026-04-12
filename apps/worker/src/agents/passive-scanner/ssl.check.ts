import * as tls from 'node:tls';
import type { FindingInput } from './types.js';

/**
 * SSL/TLS security check.
 *
 * Connects to host:443 and inspects:
 * - Certificate validity (expired = critical, <14 days = high)
 * - TLS version (TLSv1/1.1 = high)
 * - Hostname mismatch (medium)
 *
 * Uses `rejectUnauthorized: false` so we can inspect bad certs
 * instead of failing on them.
 */
export function checkSsl(host: string): Promise<FindingInput[]> {
  return new Promise((resolve) => {
    const findings: FindingInput[] = [];

    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: 10_000,
      },
      () => {
        const cert = socket.getPeerCertificate(true);
        const validTo = new Date(cert.valid_to);
        const daysLeft = (validTo.getTime() - Date.now()) / 86_400_000;

        // Certificate expired
        if (daysLeft < 0) {
          findings.push({
            source_agent: 'passive',
            template_id: 'ssl.expired',
            severity: 'critical',
            title: 'SSL tanusitvany lejart',
            description: `A tanusitvany ${cert.valid_to} ota lejart.`,
            evidence: { valid_to: cert.valid_to, issuer: cert.issuer?.CN },
            tags: ['ssl', 'certificate'],
          });
        } else if (daysLeft < 14) {
          // Expiring soon
          findings.push({
            source_agent: 'passive',
            template_id: 'ssl.expiring_soon',
            severity: 'high',
            title: 'SSL tanusitvany hamarosan lejar',
            description: `${Math.floor(daysLeft)} nap van hatra a lejaratig.`,
            evidence: { days_left: Math.floor(daysLeft), valid_to: cert.valid_to },
            tags: ['ssl', 'certificate'],
          });
        }

        // Weak TLS version
        const cipher = socket.getCipher();
        if (cipher && ['TLSv1', 'TLSv1.1'].includes(cipher.version)) {
          findings.push({
            source_agent: 'passive',
            template_id: 'ssl.weak_tls_version',
            severity: 'high',
            title: 'Elavult TLS verzio tamogatott',
            description: `A szerver meg elfogadja a ${cipher.version} verziot, amely mar nem biztonsagos.`,
            evidence: { version: cipher.version, cipher: cipher.name },
            tags: ['ssl', 'tls'],
          });
        }

        // Hostname mismatch
        const san = cert.subjectaltname ?? '';
        const cn = cert.subject?.CN ?? '';
        if (!san.includes(`DNS:${host}`) && cn !== host) {
          findings.push({
            source_agent: 'passive',
            template_id: 'ssl.hostname_mismatch',
            severity: 'medium',
            title: 'Tanusitvany hostname elteres',
            description: `A tanusitvany nem tartalmazza a(z) ${host} nevet. CN: ${cn}`,
            evidence: { cn, san, expected: host },
            tags: ['ssl', 'certificate'],
          });
        }

        socket.end();
        resolve(findings);
      },
    );

    socket.on('error', (err: Error) => {
      findings.push({
        source_agent: 'passive',
        template_id: 'ssl.connection_failed',
        severity: 'medium',
        title: 'SSL kapcsolat sikertelen',
        description: `Nem sikerult SSL kapcsolatot letesiteni: ${err.message}`,
        evidence: { error: err.message },
        tags: ['ssl'],
      });
      resolve(findings);
    });

    socket.on('timeout', () => {
      socket.destroy();
      findings.push({
        source_agent: 'passive',
        template_id: 'ssl.timeout',
        severity: 'low',
        title: 'SSL kapcsolat timeout',
        description: 'A szerver nem valaszolt 10 masodpercen belul az SSL handshake-re.',
        tags: ['ssl'],
      });
      resolve(findings);
    });
  });
}
