import type { Logger } from 'pino';
import { geminiFlash } from '../lib/gemini.js';
import { sql } from '../lib/db.js';
import { emitProgress } from '../lib/emit-progress.js';
import { config } from '../config.js';
import { calculateGeminiCost } from '../lib/cost-calculator.js';
import {
  EXEC_SUMMARY_PROMPT_ID,
  EXEC_SUMMARY_SYSTEM,
  buildExecSummaryPrompt,
  ENRICH_FINDING_PROMPT_ID,
  ENRICH_FINDING_SYSTEM,
  buildEnrichPrompt,
  type AiExplanation,
} from './prompts/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VulnerabilityRow {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  template_id: string;
  cvss_score: number | null;
  cve: string[];
  evidence: Record<string, unknown> | null;
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a report for a completed scan.
 *
 * Workflow:
 * 1. Fetch all vulnerabilities for the scan
 * 2. Count findings by severity
 * 3. Generate executive summary via Gemini Flash (Hungarian)
 * 4. Enrich high/critical findings with AI explanations (max 15)
 * 5. Track all AI usage in ai_usage table
 * 6. Create report record in reports table
 *
 * This function is NON-FATAL by design: if it fails, the scan still
 * succeeds. The caller wraps this in try/catch.
 */
export async function generateReport(
  scanJobId: string,
  domainId: string,
  orgId: string,
  host: string,
  logger: Logger,
): Promise<void> {
  const agentLogger = logger.child({ agent: 'report-generator' });
  agentLogger.info({ scanJobId, host }, 'Starting report generation');

  // ------------------------------------------------------------------
  // 1. Fetch all findings for this scan, ordered by severity
  // ------------------------------------------------------------------
  const findings = await sql<VulnerabilityRow[]>`
    SELECT id, title, description, severity, template_id, cvss_score, cve, evidence
    FROM vulnerabilities
    WHERE scan_job_id = ${scanJobId}
    ORDER BY CASE severity
      WHEN 'critical' THEN 1 WHEN 'high' THEN 2
      WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5
    END, created_at ASC
  `;

  // ------------------------------------------------------------------
  // 2. Count by severity
  // ------------------------------------------------------------------
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const sev = f.severity as keyof SeverityCounts;
    if (sev in counts) counts[sev]++;
  }

  await emitProgress(scanJobId, 'progress', { step: 'report', pct: 85 });

  // ------------------------------------------------------------------
  // 3. Generate executive summary (Gemini Flash)
  // ------------------------------------------------------------------
  const topFindings = findings
    .filter(f => f.severity === 'critical' || f.severity === 'high')
    .slice(0, 5);

  let summaryHu = buildFallbackSummary(host, findings.length, counts);

  try {
    const summaryResult = await geminiFlash.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: buildExecSummaryPrompt({ host, counts, topFindings }) }],
      }],
      systemInstruction: {
        role: 'model',
        parts: [{ text: EXEC_SUMMARY_SYSTEM }],
      },
    });

    const text = summaryResult.response.text();
    if (text.length > 0) {
      summaryHu = text;
    }

    // Track AI usage
    const usage = summaryResult.response.usageMetadata;
    if (usage) {
      await trackAiUsage(
        scanJobId,
        orgId,
        EXEC_SUMMARY_PROMPT_ID,
        config.GEMINI_MODEL_FAST,
        usage.promptTokenCount ?? 0,
        usage.candidatesTokenCount ?? 0,
      );
    }
    agentLogger.info('Executive summary generated successfully');
  } catch (err) {
    agentLogger.error({ err }, 'Failed to generate executive summary, using fallback');
    // summaryHu already set to fallback above
  }

  await emitProgress(scanJobId, 'progress', { step: 'report-enrich', pct: 90 });

  // ------------------------------------------------------------------
  // 4. Enrich high/critical findings with AI explanations (max 15)
  // ------------------------------------------------------------------
  const toEnrich = findings
    .filter(f => f.severity === 'critical' || f.severity === 'high')
    .slice(0, 15);

  let enrichedCount = 0;

  for (const finding of toEnrich) {
    try {
      const explanation = await enrichSingleFinding(
        finding,
        scanJobId,
        orgId,
        agentLogger,
      );

      if (explanation) {
        await sql`
          UPDATE vulnerabilities
          SET ai_explanation = ${JSON.stringify(explanation)}::jsonb
          WHERE id = ${finding.id}
        `;
        enrichedCount++;
      }
    } catch (err) {
      agentLogger.warn(
        { findingId: finding.id, title: finding.title, err },
        'Failed to enrich finding, skipping',
      );
      // Continue with remaining findings
    }
  }

  await emitProgress(scanJobId, 'progress', { step: 'report-save', pct: 95 });

  // ------------------------------------------------------------------
  // 5. Create report record
  // ------------------------------------------------------------------
  await sql`
    INSERT INTO reports (scan_job_id, domain_id, summary_hu, finding_count, severity_counts)
    VALUES (
      ${scanJobId},
      ${domainId},
      ${summaryHu},
      ${findings.length},
      ${JSON.stringify(counts)}::jsonb
    )
  `;

  agentLogger.info(
    {
      findingCount: findings.length,
      enriched: enrichedCount,
      enrichTarget: toEnrich.length,
      severityCounts: counts,
    },
    'Report generated successfully',
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Enrich a single finding with Gemini Flash.
 * Uses structured JSON output mode for guaranteed parseable response.
 */
async function enrichSingleFinding(
  finding: VulnerabilityRow,
  scanJobId: string,
  orgId: string,
  logger: Logger,
): Promise<AiExplanation | null> {
  const enrichResult = await geminiFlash.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: buildEnrichPrompt(finding) }],
    }],
    systemInstruction: {
      role: 'model',
      parts: [{ text: ENRICH_FINDING_SYSTEM }],
    },
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const text = enrichResult.response.text();

  // Track usage regardless of parse success
  const usage = enrichResult.response.usageMetadata;
  if (usage) {
    await trackAiUsage(
      scanJobId,
      orgId,
      ENRICH_FINDING_PROMPT_ID,
      config.GEMINI_MODEL_FAST,
      usage.promptTokenCount ?? 0,
      usage.candidatesTokenCount ?? 0,
    );
  }

  // Parse and validate the JSON response
  const parsed: unknown = JSON.parse(text);
  if (!isValidExplanation(parsed)) {
    logger.warn(
      { findingId: finding.id, response: text.slice(0, 500) },
      'Gemini returned invalid explanation structure',
    );
    return null;
  }

  return parsed;
}

/**
 * Type guard for AI explanation response.
 */
function isValidExplanation(obj: unknown): obj is AiExplanation {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.mi_ez === 'string' &&
    typeof o.miert_veszelyes === 'string' &&
    Array.isArray(o.javitas) &&
    o.javitas.every((item: unknown) => typeof item === 'string')
  );
}

/**
 * Fallback summary when Gemini is unavailable.
 */
function buildFallbackSummary(
  host: string,
  totalFindings: number,
  counts: SeverityCounts,
): string {
  const lines: string[] = [
    `### Osszegzes`,
    ``,
    `A(z) ${host} domain biztonsagi vizsgalata befejezodott. Osszesen ${totalFindings} `,
    `talalt keruelt rogzitesre.`,
  ];

  if (counts.critical > 0 || counts.high > 0) {
    lines.push(
      ``,
      `### Fobb kockazatok`,
      ``,
      `A vizsgalat soran ${counts.critical} kritikus es ${counts.high} magas kockazatu `,
      `serulekenyseg keruelt felderitesre. Ezek azonnali figyelmet igenyelnek.`,
    );
  }

  lines.push(
    ``,
    `### Javasolt lepesek`,
    ``,
    `1. Tekintse at a reszletes talalatokat a megfelelo prioritas megalllapitasahoz.`,
    `2. A kritikus es magas kockazatu elemeknel javasolt szakerto bevonasa.`,
    ``,
    `*A reszletes AI-osszegzes atmeneti technikai hiba miatt nem erheto el.*`,
  );

  return lines.join('\n');
}

/**
 * Record an AI API call in the ai_usage table for cost tracking.
 */
async function trackAiUsage(
  scanJobId: string,
  orgId: string,
  promptId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const costUsd = calculateGeminiCost(model, inputTokens, outputTokens);

  await sql`
    INSERT INTO ai_usage (scan_job_id, organization_id, prompt_id, model, input_tokens, output_tokens, cost_usd)
    VALUES (${scanJobId}, ${orgId}, ${promptId}, ${model}, ${inputTokens}, ${outputTokens}, ${costUsd})
  `;
}
