/**
 * Prompt: exec-summary:v1
 *
 * Generates a Hungarian-language executive summary for non-technical
 * business leaders. Designed for Gemini Flash model.
 */

export interface ExecSummaryInput {
  host: string;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  topFindings: Array<{
    severity: string;
    title: string;
    description?: string | null;
  }>;
}

export const EXEC_SUMMARY_PROMPT_ID = 'exec-summary:v1' as const;

/**
 * System instruction (Hungarian) -- tells Gemini to act as a cybersecurity
 * expert writing for CEOs / decision-makers. Avoids alarmist language.
 */
export const EXEC_SUMMARY_SYSTEM = `Te egy kiberbiztonsagi szakerto vagy, aki magyar nyelven ir ertheto, nem tul technikai osszefoglalot cegvezetok szamara. Legy targyilagos, vilagos, konstruktiv. Az olvaso nem fejleszto, hanem donteshozo. A cel: megertse mi tortent, mi a kockazat, milyen uzleti dontest kell hoznia.

Keruelndo szavak: "katasztrofalis", "halalos", "vegzetes", "totalis".
Hasznalatos: "fokozott kockazat", "javasolt beavatkozas", "erdemes prioritassal kezelni".
Ne emlitsd: konkret CVE szamokat, template ID-kat.

Format: 2-3 bekezdes, max 300 szo. Markdown formatumban, magyarul.

### Osszegzes
(2-3 mondat az altalanos allapotrol)

### Fobb kockazatok
- (3-5 pont uzleti nyelven, nem technikai)

### Javasolt lepesek
1. (azonnali: 0-7 nap)
2. (rovid tavu: 1-4 het)
3. (kozep tavu: 1-3 honap)`;

/**
 * Build the user-facing prompt for the executive summary.
 */
export function buildExecSummaryPrompt(input: ExecSummaryInput): string {
  const { host, counts, topFindings } = input;

  const topList = topFindings.length > 0
    ? topFindings
        .map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.title}\n   Rovid leiras: ${(f.description ?? 'N/A').slice(0, 200)}`)
        .join('\n\n')
    : 'Nincs kritikus vagy magas kockazatu talalt.';

  return `Keszits executive summary-t a(z) **${host}** domain biztonsagi vizsgalatarol.

## Talaltok megoszlasa
- Kritikus: ${counts.critical}
- Magas: ${counts.high}
- Kozepes: ${counts.medium}
- Alacsony: ${counts.low}
- Informacios: ${counts.info}

## Top talaltok
${topList}`;
}
