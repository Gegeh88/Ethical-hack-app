import { resolveTxt, resolveCaa } from 'node:dns/promises';
import type { FindingInput } from './types.js';

/**
 * DNS security check.
 *
 * Inspects DNS records for email security and certificate authority authorization:
 * - SPF record (v=spf1 in TXT records on the host)
 * - DMARC record (TXT records on _dmarc.{host})
 * - CAA record (Certificate Authority Authorization)
 *
 * Missing records indicate email spoofing or certificate issuance risks.
 */
export async function checkDns(host: string): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  // --- SPF check ---
  try {
    const txtRecords = await resolveTxt(host);
    // resolveTxt returns string[][] — each record is an array of chunks
    const flat = txtRecords.map((chunks) => chunks.join(''));
    const spfRecord = flat.find((r) => r.startsWith('v=spf1'));

    if (!spfRecord) {
      findings.push({
        source_agent: 'passive',
        template_id: 'dns.missing_spf',
        severity: 'medium',
        title: 'Hianyzik az SPF rekord',
        description:
          'SPF (Sender Policy Framework) rekord nelkul barki kuldheti e-mailt a domain neveben, ami adathalaaszathoz (phishing) vezethet.',
        evidence: { txt_records: flat.slice(0, 10) },
        tags: ['dns', 'email-security'],
      });
    }
  } catch (err) {
    // ENOTFOUND / ENODATA means no TXT records at all
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      findings.push({
        source_agent: 'passive',
        template_id: 'dns.missing_spf',
        severity: 'medium',
        title: 'Hianyzik az SPF rekord',
        description:
          'A domain-hoz nem tartozik SPF rekord. Barki kuldheti e-mailt a domain neveben.',
        tags: ['dns', 'email-security'],
      });
    } else {
      throw err;
    }
  }

  // --- DMARC check ---
  try {
    const dmarcRecords = await resolveTxt(`_dmarc.${host}`);
    const flat = dmarcRecords.map((chunks) => chunks.join(''));
    const dmarcRecord = flat.find((r) => r.startsWith('v=DMARC1'));

    if (!dmarcRecord) {
      findings.push({
        source_agent: 'passive',
        template_id: 'dns.missing_dmarc',
        severity: 'medium',
        title: 'Hianyzik a DMARC rekord',
        description:
          'DMARC (Domain-based Message Authentication, Reporting & Conformance) nelkul nincs szabalyzat az e-mail hitelesites meghiusulasanak kezelesere.',
        evidence: { dmarc_txt: flat.slice(0, 5) },
        tags: ['dns', 'email-security'],
      });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      findings.push({
        source_agent: 'passive',
        template_id: 'dns.missing_dmarc',
        severity: 'medium',
        title: 'Hianyzik a DMARC rekord',
        description:
          'A domain-hoz nem tartozik DMARC rekord. Nincs szabalyzat a hamis e-mailek kezelesere.',
        tags: ['dns', 'email-security'],
      });
    } else {
      throw err;
    }
  }

  // --- CAA check ---
  try {
    const caaRecords = await resolveCaa(host);

    if (!caaRecords || caaRecords.length === 0) {
      findings.push({
        source_agent: 'passive',
        template_id: 'dns.missing_caa',
        severity: 'low',
        title: 'Hianyzik a CAA rekord',
        description:
          'CAA (Certification Authority Authorization) rekord nelkul barmely CA kiallithat tanusitvanyt a domain-hoz, ami megkonnyiti a jogosulatlan tanusitvany-kiallitast.',
        tags: ['dns', 'certificate'],
      });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      findings.push({
        source_agent: 'passive',
        template_id: 'dns.missing_caa',
        severity: 'low',
        title: 'Hianyzik a CAA rekord',
        description:
          'A domain-hoz nem tartozik CAA rekord. Barmely tanusitvany-kiallito (CA) kiallithat tanusitvanyt.',
        tags: ['dns', 'certificate'],
      });
    } else {
      throw err;
    }
  }

  return findings;
}
