/**
 * Prompt: enrich-finding:v1
 *
 * Generates Hungarian-language AI explanations for high/critical findings.
 * Uses Gemini Flash with structured JSON output (responseMimeType: 'application/json').
 */

export interface EnrichFindingInput {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  template_id: string;
  cvss_score?: number | null;
  cve?: string[];
  evidence?: Record<string, unknown> | null;
}

/**
 * The shape of the JSON response we expect from Gemini.
 */
export interface AiExplanation {
  mi_ez: string;
  miert_veszelyes: string;
  javitas: string[];
}

export const ENRICH_FINDING_PROMPT_ID = 'enrich-finding:v1' as const;

/**
 * System instruction (Hungarian) -- produces structured JSON per finding.
 * When used with responseMimeType: 'application/json', Gemini guarantees
 * valid JSON output matching this schema.
 */
export const ENRICH_FINDING_SYSTEM = `Te egy kiberbiztonsagi szakerto vagy. Adj magyar nyelvu, ertheto magyarazatot a serulekenysegrol. Valaszolj KIZAROLAG JSON formatumban, a kovetkezo strukturaval:
{
  "mi_ez": "Egy mondatos magyarazat, mi ez a serulekenyseg",
  "miert_veszelyes": "1-2 mondatos magyarazat, miert veszelyes",
  "javitas": ["Elso javitasi lepes", "Masodik javitasi lepes", "Harmadik javitasi lepes"]
}

A "javitas" tombben 2-5 konkret, kivitelezheto lepest adj.
A celkozonseg magyar fejlesztok es rendszergazdak, akik nem feltetlenul jartasak biztonsagi temakban.
Hasznalj egyertelmu, vilagos nyelvet — keraueld a tuzhanyar-szavakat ("katasztrofalis", "haladektalan", "vegzetes").`;

/**
 * Build the user-facing prompt for a single finding enrichment.
 */
export function buildEnrichPrompt(finding: EnrichFindingInput): string {
  return `Serulekenyseg: ${finding.title}
Leiras: ${finding.description ?? 'N/A'}
Sulyossag: ${finding.severity}
CVSS: ${finding.cvss_score ?? 'N/A'}
Template: ${finding.template_id}
CVE: ${finding.cve?.join(', ') || 'N/A'}`;
}
